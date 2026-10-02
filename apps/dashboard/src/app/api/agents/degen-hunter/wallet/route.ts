import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";
import { resolveDegenOwnerChatId } from "@/lib/degen-identity";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { encryptPrivateKey, verifyPinWithLockout } from "@max/shared";
import { pinRejectionResponse } from "@/lib/degen-pin";
import { fetchLivePrices, type LivePrice } from "@/lib/dex-prices";
import { reconcilePositions } from "@/lib/reconcile-positions";

const SOLANA_RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC_ENDPOINT, "confirmed");

/**
 * DELETE /api/agents/degen-hunter/wallet
 * Deletes the burner wallet and creates a new one. Requires PIN.
 * Fails if there are funds or open positions.
 */
export async function DELETE(req: NextRequest) {
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { pin: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { pin } = body;
  if (!pin) return NextResponse.json({ error: "PIN is required" }, { status: 400 });

  const pinCheck = await verifyPinWithLockout(chatId, pin);
  if (!pinCheck.ok) {
    return pinRejectionResponse(pinCheck);
  }

  const wallet = await prisma.degenHunterWallet.findUnique({ where: { chatId } });
  if (!wallet) return NextResponse.json({ error: "No wallet to delete" }, { status: 404 });

  // Check open positions
  const openPositions = await prisma.degenHunterPosition.count({
    where: { chatId, status: "OPEN" }
  });
  if (openPositions > 0) {
    return NextResponse.json({ error: "Cannot delete wallet with open positions. Sell them first." }, { status: 400 });
  }

  // Check balance (Solana)
  try {
    const lamports = await connection.getBalance(new (require("@solana/web3.js").PublicKey)(wallet.publicKey));
    if (lamports > 0.005 * 1e9) { // allow deleting if only dust remains
      return NextResponse.json({ error: "Cannot delete wallet. Send out your remaining SOL first." }, { status: 400 });
    }
  } catch (err) {
    // If RPC fails, we fail safe
    return NextResponse.json({ error: "Failed to verify balance. Try again later." }, { status: 500 });
  }

  // Generate new wallet
  const newKeypair = Keypair.generate();
  const privateKeyBase58 = bs58.encode(newKeypair.secretKey);
  const publicKey = newKeypair.publicKey.toBase58();
  const { encryptedKey, iv } = encryptPrivateKey(privateKeyBase58);

  await prisma.degenHunterWallet.update({
    where: { chatId },
    data: { publicKey, encryptedKey, iv, balance: 0 }
  });

  // Clear trade history
  await prisma.degenHunterPosition.deleteMany({ where: { chatId } });

  return NextResponse.json({ status: "success", publicKey });
}

export async function GET(req: NextRequest) {
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const wallet = await prisma.degenHunterWallet.findUnique({ where: { chatId } });
  if (!wallet) {
    return NextResponse.json({
      status: "not_initialized",
      address: null,
      balanceSol: 0,
      positions: [],
      recentActivity: []
    });
  }

  let balanceSol: number = wallet.balance ? Number(wallet.balance) : 0;
  let balanceSource = "db";
  try {
    const lamports = await connection.getBalance(new (require("@solana/web3.js").PublicKey)(wallet.publicKey));
    balanceSol = lamports / 1e9;
    balanceSource = "solana_rpc";
  } catch (err) {
    console.error("Failed to fetch balance from RPC", err);
  }

  // The wallet is the truth: close positions it no longer holds, fix amounts that drifted. Never blocks the page.
  if (wallet.publicKey) await reconcilePositions(chatId, SOLANA_RPC_ENDPOINT, wallet.publicKey).catch((e) => console.error("reconcile failed", e));

  const positionRows = await prisma.degenHunterPosition.findMany({
    where: { chatId },
    orderBy: { createdAt: "desc" }
  });

  // What the wallet actually holds on-chain, priced live. Positions are the trade
  // log; this is the real balance sheet (it also catches tokens bought outside the app).
  const heldMints = wallet.publicKey ? await getHeldTokenAccounts(wallet.publicKey) : [];
  const live = await fetchLivePrices([...new Set([...heldMints.map((h) => h.mint), ...positionRows.map((p) => p.tokenAddress)])]).catch(
    () => new Map<string, LivePrice>()
  );
  const tokens = heldMints
    .map((h) => {
      const lp = live.get(h.mint);
      const symbol = lp?.symbol ?? positionRows.find((p) => p.tokenAddress === h.mint)?.tokenSymbol ?? `${h.mint.slice(0, 4)}…${h.mint.slice(-4)}`;
      return {
        mint: h.mint,
        symbol,
        name: lp?.name ?? null,
        amount: h.amount,
        priceUsd: lp?.priceUsd ?? null,
        valueUsd: lp ? h.amount * lp.priceUsd : null,
      };
    })
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  // These columns are Prisma Decimals, which JSON-serialize as strings ("0.0100").
  // Every consumer treats them as numbers (.toFixed etc.), so convert here, once.
  // Also repair a symbol that was saved as the token's address prefix (older dashboard
  // buys did that) once the real symbol is known — in the response and in the DB, so
  // Telegram and the trade cards show it properly too.
  // Repair positions saved with the old "every token has 6 decimals" assumption. The
  // chain is the truth: if the wallet holds a power-of-ten different amount than the
  // position recorded (1000× for a 9-decimal token), the recorded amount — and so the
  // entry price derived from it — are off by that factor. Value in = amount × price is
  // fixed, so correct both. Only when exactly one open position holds that mint, so
  // nothing ambiguous is touched.
  const heldByMint = new Map(heldMints.map((h) => [h.mint, h.amount]));
  for (const p of positionRows) {
    const held = heldByMint.get(p.tokenAddress);
    const recorded = Number(p.tokenAmount);
    const openForMint = positionRows.filter((q) => q.tokenAddress === p.tokenAddress && q.status === "OPEN");
    if (p.status !== "OPEN" || openForMint.length !== 1 || !held || !(recorded > 0)) continue;
    const exp = Math.log10(held / recorded);
    if (Math.abs(exp) < 0.5 || Math.abs(exp - Math.round(exp)) > 0.02) continue; // already right, or not a clean decimals mix-up
    const fixedEntry = Number(p.entryPriceUsd) * (recorded / held);
    p.tokenAmount = held as unknown as typeof p.tokenAmount;
    p.entryPriceUsd = fixedEntry as unknown as typeof p.entryPriceUsd;
    prisma.degenHunterPosition.update({ where: { id: p.id }, data: { tokenAmount: held, entryPriceUsd: fixedEntry } }).catch(() => {});
  }

  const positions = positionRows.map((p) => {
    const realSymbol = live.get(p.tokenAddress)?.symbol;
    let tokenSymbol = p.tokenSymbol;
    if (realSymbol && p.tokenSymbol === p.tokenAddress.slice(0, p.tokenSymbol.length) && realSymbol !== p.tokenSymbol) {
      tokenSymbol = realSymbol;
      prisma.degenHunterPosition.update({ where: { id: p.id }, data: { tokenSymbol: realSymbol } }).catch(() => {});
    }
    return {
      ...p,
      tokenSymbol,
      tokenAmount: Number(p.tokenAmount),
      amountSOL: Number(p.amountSOL),
      entryPriceUsd: Number(p.entryPriceUsd),
    };
  });

  const recentActivity = positions.map(p => ({
    id: p.id,
    tokenAddress: p.tokenAddress,
    tokenSymbol: p.tokenSymbol,
    amountSOL: p.amountSOL,
    entryPriceUsd: p.entryPriceUsd,
    status: p.status,
    timestamp: p.createdAt.toISOString()
  }));

  const [sol, transactions] = await Promise.all([getSolMarket(), getWalletEvents()]);

  return NextResponse.json({
    status: balanceSol > 0.005 ? "funded" : "unfunded",
    address: wallet.publicKey,
    balanceSol,
    balanceSource,
    solUsd: sol?.priceUsd ?? null,
    solChange24h: sol?.change24h ?? null,
    positions,
    recentActivity,
    tokens,
    transactions
  });
}

const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPSq2b"]; // SPL Token, Token-2022

/** Non-zero SPL token balances held by `owner`, read from the chain. Empty (not an error) if the RPC call fails. */
async function getHeldTokenAccounts(owner: string): Promise<{ mint: string; amount: number }[]> {
  try {
    const ownerKey = new PublicKey(owner);
    const results = await Promise.all(
      TOKEN_PROGRAMS.map((p) => connection.getParsedTokenAccountsByOwner(ownerKey, { programId: new PublicKey(p) }).catch(() => null))
    );
    const byMint = new Map<string, number>();
    for (const r of results) {
      for (const acc of r?.value ?? []) {
        const info = (acc.account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number | null } } } }).parsed?.info;
        const amount = info?.tokenAmount?.uiAmount ?? 0;
        if (info?.mint && amount > 0) byMint.set(info.mint, (byMint.get(info.mint) ?? 0) + amount);
      }
    }
    return [...byMint].map(([mint, amount]) => ({ mint, amount }));
  } catch (err) {
    console.error("Failed to read token accounts", err);
    return [];
  }
}

const SOL_MINT = "So11111111111111111111111111111111111111112";
let solCache: { at: number; value: { priceUsd: number; change24h: number | null } | null } | null = null;

/** SOL/USD and 24h change from DexScreener (the same source Degen Hunter already uses), cached 60s. Null on any failure — never a guessed price. */
async function getSolMarket(): Promise<{ priceUsd: number; change24h: number | null } | null> {
  if (solCache && Date.now() - solCache.at < 60_000) return solCache.value;
  let value: { priceUsd: number; change24h: number | null } | null = null;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = (await res.json()) as { pairs?: { priceUsd?: string; priceChange?: { h24?: number }; liquidity?: { usd?: number } }[] };
      const best = (data.pairs ?? [])
        .filter((p) => p.priceUsd)
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      if (best?.priceUsd) value = { priceUsd: Number(best.priceUsd), change24h: best.priceChange?.h24 ?? null };
    }
  } catch { /* leave null */ }
  solCache = { at: Date.now(), value };
  return value;
}

/**
 * Withdrawals and failed transactions, as recorded by the send/trade routes
 * (ActivityLog rows tagged with meta.kind). Buys/sells come from the position
 * table instead; these are the events positions can't represent.
 */
async function getWalletEvents() {
  const rows = await prisma.activityLog.findMany({
    where: { agentKey: "degen-hunter", meta: { contains: '"kind"' } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const out: { id: number; kind: string; label: string; detail: string | null; amountSOL: number | null; timestamp: string }[] = [];
  for (const r of rows) {
    try {
      const m = JSON.parse(r.meta ?? "{}") as { kind?: string; label?: string; detail?: string; amountSOL?: number };
      if (m.kind === "withdraw" || m.kind === "withdraw_failed" || m.kind === "trade_failed") {
        out.push({ id: r.id, kind: m.kind, label: m.label ?? r.message, detail: m.detail ?? null, amountSOL: m.amountSOL ?? null, timestamp: r.createdAt.toISOString() });
      }
    } catch { /* skip malformed */ }
  }
  return out;
}
