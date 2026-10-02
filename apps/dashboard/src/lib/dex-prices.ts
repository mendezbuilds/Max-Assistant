/**
 * Live token prices from DexScreener, for tokens the owner actually holds.
 * Position and wallet views used to rely on whatever price the scanner had
 * happened to cache, which is nothing for a token it hasn't recently seen.
 */
export interface LivePrice {
  priceUsd: number;
  symbol?: string;
  name?: string;
  marketCapUsd?: number;
  liquidityUsd?: number;
}

interface DexPair {
  baseToken?: { address?: string; symbol?: string; name?: string };
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
}

// Short cache so several views polling at once (positions, wallet, alerts)
// share one DexScreener call instead of hammering it.
const TTL_MS = 20_000;
const cache = new Map<string, { at: number; value: LivePrice | null }>();

/** Best-liquidity pair per token. Tokens DexScreener has no market for are simply absent from the result. */
export async function fetchLivePrices(addresses: string[]): Promise<Map<string, LivePrice>> {
  const out = new Map<string, LivePrice>();
  const now = Date.now();
  const stale: string[] = [];
  for (const a of [...new Set(addresses.filter(Boolean))]) {
    const hit = cache.get(a);
    if (hit && now - hit.at < TTL_MS) {
      if (hit.value) out.set(a, hit.value);
    } else {
      stale.push(a);
    }
  }

  for (let i = 0; i < stale.length; i += 30) {
    const chunk = stale.slice(i, i + 30);
    const best = new Map<string, LivePrice>();
    try {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const pairs = (await res.json()) as DexPair[];
        for (const p of Array.isArray(pairs) ? pairs : []) {
          const addr = p.baseToken?.address;
          const price = Number(p.priceUsd);
          if (!addr || !(price > 0)) continue;
          const liq = p.liquidity?.usd ?? 0;
          if (!best.has(addr) || liq > (best.get(addr)?.liquidityUsd ?? 0)) {
            best.set(addr, { priceUsd: price, symbol: p.baseToken?.symbol, name: p.baseToken?.name, marketCapUsd: p.marketCap ?? p.fdv, liquidityUsd: liq });
          }
        }
      }
    } catch {
      // network/rate-limit: leave these uncached so the next call retries
      continue;
    }
    for (const a of chunk) {
      const value = best.get(a) ?? null;
      cache.set(a, { at: now, value });
      if (value) out.set(a, value);
    }
  }
  return out;
}
