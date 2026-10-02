/**
 * Real-wallet guards for the Degen Hunter trade paths. Pure TypeScript over JSON-RPC (no web3.js),
 * so core and the dashboard share one implementation.
 *
 * Why this exists: sells used the position's RECORDED token amount (the buy quote's estimate) instead of what
 * the wallet actually holds. A buy that quoted 16340.85 tokens but delivered 16323.08 left every "sell 100%"
 * asking for ~18 more tokens than exist, which the SPL Token program rejects with error 0x1 (InsufficientFunds).
 * The app then matched "0x1" and told the owner to deposit more SOL, which was never the problem. And a position
 * sold outside the app stayed "open" forever because nothing compared the database with the chain.
 */

export interface Holding {
  ok: true;
  /** Smallest units, summed across every token account the wallet has for the mint. */
  raw: bigint;
  decimals: number;
  ui: number;
}
export type HoldingResult = Holding | { ok: false; error: string };

async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`RPC responded ${res.status}`);
  const body = (await res.json()) as any;
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return body.result;
}

/** What the wallet really holds of a mint, right now. `ok: false` means "couldn't find out" — never treat that as zero. */
export async function getTokenHolding(rpcUrl: string, owner: string, mint: string): Promise<HoldingResult> {
  try {
    const r = await rpc(rpcUrl, "getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }]);
    let raw = 0n;
    let decimals = 0;
    for (const a of r?.value ?? []) {
      const t = a?.account?.data?.parsed?.info?.tokenAmount;
      if (!t) continue;
      raw += BigInt(t.amount);
      decimals = Number(t.decimals);
    }
    if ((r?.value ?? []).length === 0) {
      // No token account at all. Decimals still matter for callers, so look them up (best effort).
      try {
        const s = await rpc(rpcUrl, "getTokenSupply", [mint]);
        decimals = Number(s?.value?.decimals ?? 0);
      } catch { /* leave 0 */ }
    }
    return { ok: true, raw, decimals, ui: Number(raw) / Math.pow(10, decimals) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** The smallest-unit amount for "sell `percent`% of what the wallet holds" — exact for 100%, never more than held. */
export function sellAmountRaw(heldRaw: bigint, percent: number): bigint {
  if (!(percent > 0)) return 0n;
  if (percent >= 100) return heldRaw;
  return (heldRaw * BigInt(Math.round(percent * 100))) / 10000n;
}

/** SOL a swap needs on hand besides the amount being traded: network fee, possible priority fee, and a wrapped-SOL / token account's rent. */
export const MIN_SOL_FOR_FEES = 0.004;

export type TradeErrorKind = "no-tokens" | "token-balance" | "sol-for-fees" | "slippage" | "no-route" | "other";

/**
 * Names what actually failed. The old check was `msg.includes("insufficient") || msg.includes("0x1")`, which
 * also matched slippage (0x1771), blockhash and other unrelated errors, and always answered "deposit more SOL".
 */
export function classifyTradeError(msg: string): { kind: TradeErrorKind; message: string } {
  const m = msg.toLowerCase();
  // SOL really is short: the runtime's own wording for not covering fees/rent.
  if (m.includes("insufficient funds for fee") || m.includes("insufficientfundsforfee") || m.includes("insufficient lamports") || m.includes("attempt to debit an account but found no record")) {
    return { kind: "sol-for-fees", message: "The wallet doesn't have enough SOL to cover network fees and account rent." };
  }
  // SPL Token program error 0x1 = InsufficientFunds: the wallet holds fewer TOKENS than the swap tried to move. (Exact match: 0x1771 etc. are different errors.)
  if (/custom program error: 0x1(?![0-9a-f])/.test(m) || /"custom":\s*1\b/.test(m) || m.includes("insufficient funds") || m.includes("insufficient token")) {
    return { kind: "token-balance", message: "The wallet holds fewer tokens than the swap tried to sell (not a SOL problem)." };
  }
  if (/0x1771|0x1788|6001|6024|slippage/.test(m)) {
    return { kind: "slippage", message: "The price moved past the slippage limit before the swap landed. Retrying (or a higher slippage) may work." };
  }
  if (m.includes("could_not_find_any_route") || m.includes("token_not_tradable") || m.includes("no route")) {
    return { kind: "no-route", message: "Jupiter has no swap route for this token right now." };
  }
  return { kind: "other", message: msg.slice(0, 300) };
}

// ─── Reconciling the database with the wallet ───────────────────────────────

export interface OpenPositionLite {
  id: number;
  tokenAddress: string;
  tokenAmount: number;
  /** ms since epoch the position was recorded. */
  createdAtMs: number;
}
export type ReconcileAction =
  | { type: "close"; id: number; reason: string }
  | { type: "set-amount"; id: number; amount: number; was: number };

/** A position this young might not be visible to the RPC yet; never auto-close one. */
export const RECONCILE_MIN_AGE_MS = 2 * 60_000;
/** Recorded amount may differ from the wallet's by this fraction before it's rewritten (dust / rounding). */
const AMOUNT_TOLERANCE = 0.0001;

/**
 * Decides how to bring OPEN positions in line with the wallet. `holdings` maps mint -> lookup result; a failed or
 * missing lookup yields no action (unknown is not "sold"). Pure, so it can be tested.
 */
export function planReconcile(positions: OpenPositionLite[], holdings: Map<string, HoldingResult>, nowMs: number): ReconcileAction[] {
  const perMint = new Map<string, number>();
  for (const p of positions) perMint.set(p.tokenAddress, (perMint.get(p.tokenAddress) ?? 0) + 1);

  const out: ReconcileAction[] = [];
  for (const p of positions) {
    const h = holdings.get(p.tokenAddress);
    if (!h || !h.ok) continue;
    if (nowMs - p.createdAtMs < RECONCILE_MIN_AGE_MS) continue;
    if (h.raw === 0n) {
      out.push({ type: "close", id: p.id, reason: "the wallet no longer holds this token (sold or moved outside the app)" });
    } else if ((perMint.get(p.tokenAddress) ?? 0) === 1 && p.tokenAmount > 0 && Math.abs(h.ui - p.tokenAmount) / p.tokenAmount > AMOUNT_TOLERANCE) {
      out.push({ type: "set-amount", id: p.id, amount: h.ui, was: p.tokenAmount });
    }
  }
  return out;
}
