/**
 * Can Jupiter route a buy of this token right now? Asks for a small quote (sends
 * nothing). Used to badge tokens as tradable or not before anyone clicks Buy.
 */
const JUPITER_API = (process.env.JUPITER_API_BASE?.trim() || "https://lite-api.jup.ag/swap/v1").replace(/\/$/, "");
const SOL_MINT = "So11111111111111111111111111111111111111112";
const PROBE_LAMPORTS = 10_000_000; // 0.01 SOL

export interface Tradable {
  tradable: boolean;
  reason?: string;
  priceImpactPct?: number;
}

// A new token's status changes within minutes (it gets indexed), so keep this
// short; but long enough that several views polling at once share one lookup.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Tradable | null }>();

function reasonFor(q: { errorCode?: string; error?: string } | null): string {
  if (q?.errorCode === "TOKEN_NOT_TRADABLE") return "Jupiter has no route for this token yet. New tokens can take a few minutes to be indexed.";
  if (q?.errorCode === "COULD_NOT_FIND_ANY_ROUTE") return "No swap route found — liquidity is probably too thin.";
  return q?.error || "No route available";
}

async function checkOne(mint: string): Promise<Tradable | null> {
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: Tradable | null = null;
  try {
    const res = await fetch(
      `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${mint}&amount=${PROBE_LAMPORTS}&slippageBps=300`,
      { signal: AbortSignal.timeout(8000) }
    );
    const q = (await res.json()) as { outAmount?: string; priceImpactPct?: string; errorCode?: string; error?: string };
    value = q.outAmount
      ? { tradable: true, priceImpactPct: Number(q.priceImpactPct) * 100 }
      : { tradable: false, reason: reasonFor(q) };
  } catch {
    return null; // couldn't reach Jupiter: unknown, and not cached so the next call retries
  }
  cache.set(mint, { at: Date.now(), value });
  return value;
}

/** Tradability for each mint (omitted from the result when it couldn't be determined). Small concurrency to stay inside Jupiter's free rate limit. */
export async function checkTradableMany(mints: string[]): Promise<Record<string, Tradable>> {
  const unique = [...new Set(mints.filter(Boolean))].slice(0, 20);
  const out: Record<string, Tradable> = {};
  const queue = [...unique];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let m = queue.shift(); m; m = queue.shift()) {
        const v = await checkOne(m);
        if (v) out[m] = v;
      }
    })
  );
  return out;
}
