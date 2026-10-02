import type { TradeStats } from "./trade-card";

/**
 * Optional extras for the closed-trade card: the token's logo, its chain, and a REAL price
 * trajectory for the time the position was open. Fetched when the card is rendered.
 *
 * Nothing here is ever invented. Each piece is independent and best-effort: if a lookup fails,
 * times out, or doesn't check out, that piece is `null` and the card simply omits it — a card
 * without a sparkline is correct; a made-up one would not be. Never throws.
 */
export interface CardExtras {
  /** A small raster image as a data: URI, ready to embed in the SVG. */
  logoDataUri: string | null;
  chain: string | null;
  /** Closing prices (USD), oldest → newest, from real 1-minute candles over the trade's lifetime. */
  spark: number[] | null;
}

export const NO_EXTRAS: CardExtras = { logoDataUri: null, chain: null, spark: null };

const SPARK_MIN_POINTS = 5;
const SPARK_MAX_POINTS = 48;
const LOGO_MAX_BYTES = 400_000;
/** The candles must roughly agree with the prices we actually recorded; if not, they're a different story and we show nothing. */
const SPARK_AGREEMENT_FACTOR = 3;

// Same trade, same card: remember the result so re-opening a card (or the dashboard modal reloading) is instant.
const cache = new Map<string, Promise<CardExtras>>();

/** Epoch ms from a Date, a number, or a SQLite "YYYY-MM-DD HH:MM:SS" string (which is UTC, but JS would parse as local time). */
export function toEpochMs(v: Date | number | string): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) return Date.parse(v.replace(" ", "T") + "Z");
  return Date.parse(v);
}

async function getJson(url: string, ms: number, headers?: Record<string, string>): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms), headers });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Only raster formats resvg draws safely, identified by their magic bytes (never trust the URL or content-type alone). */
function imageMime(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

async function fetchLogo(imageUrl: string, ms: number): Promise<string | null> {
  try {
    const u = new URL(imageUrl);
    // Only DexScreener's own image CDN, over https — this URL comes from a third-party API response.
    if (u.protocol !== "https:" || u.hostname !== "cdn.dexscreener.com") return null;
    // The CDN resizes on request: ask for a small avatar, not the 800px original.
    u.searchParams.set("width", "160");
    u.searchParams.set("height", "160");
    u.searchParams.set("quality", "85");
    const res = await fetch(u, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > LOGO_MAX_BYTES) return null;
    const mime = imageMime(buf);
    return mime ? `data:${mime};base64,${Buffer.from(buf).toString("base64")}` : null;
  } catch {
    return null;
  }
}

async function fetchSpark(pair: string, openedMs: number, closedMs: number, entry: number, exit: number, ms: number): Promise<number[] | null> {
  const openSec = Math.floor(openedMs / 1000);
  const closeSec = Math.floor(closedMs / 1000);
  const minutes = Math.min(1000, Math.max(1, Math.round((closeSec - openSec) / 60)) + 20);
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${encodeURIComponent(pair)}/ohlcv/minute?aggregate=1&before_timestamp=${closeSec + 120}&limit=${minutes}&currency=usd`;
  // GeckoTerminal's free tier is rate limited (about 30 requests/minute) and answers 429 when it's hit; one short retry
  // turns most of those into a chart instead of a missing one.
  let data = await getJson(url, ms, { Accept: "application/json;version=20230302" });
  if (!data) {
    await new Promise((r) => setTimeout(r, 1500));
    data = await getJson(url, ms, { Accept: "application/json;version=20230302" });
  }
  const list: number[][] = data?.data?.attributes?.ohlcv_list ?? [];
  const win = list
    .filter((c) => Array.isArray(c) && c[0] >= openSec - 60 && c[0] <= closeSec + 60 && c[4] > 0)
    .sort((a, b) => a[0] - b[0]);
  if (win.length < SPARK_MIN_POINTS) return null;

  let closes = win.map((c) => c[4]);
  // Downsample (keeping the first and last points) so a long hold doesn't produce a noisy, heavy path.
  if (closes.length > SPARK_MAX_POINTS) {
    const step = (closes.length - 1) / (SPARK_MAX_POINTS - 1);
    closes = Array.from({ length: SPARK_MAX_POINTS }, (_, i) => closes[Math.round(i * step)]);
  }

  // Sanity: the line must start near our recorded entry and end near our recorded exit.
  const near = (a: number, b: number) => b > 0 && a > 0 && Math.max(a / b, b / a) <= SPARK_AGREEMENT_FACTOR;
  if (!near(closes[0], entry) || !near(closes[closes.length - 1], exit || closes[closes.length - 1])) return null;
  return closes;
}

async function compute(s: TradeStats, timeoutMs: number): Promise<CardExtras> {
  const out: CardExtras = { ...NO_EXTRAS };
  const address = s.tokenAddress;
  if (!address) return out;

  const pairs = await getJson(`https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(address)}`, timeoutMs);
  const best = Array.isArray(pairs)
    ? [...pairs].sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]
    : null;
  if (!best) return out;

  out.chain = typeof best.chainId === "string" ? best.chainId : "solana";
  const [logo, spark] = await Promise.all([
    best.info?.imageUrl ? fetchLogo(String(best.info.imageUrl), timeoutMs) : Promise.resolve(null),
    best.pairAddress ? fetchSpark(String(best.pairAddress), toEpochMs(s.openedAt), toEpochMs(s.closedAt), s.entryPriceUsd, s.exitPriceUsd, timeoutMs) : Promise.resolve(null),
  ]);
  out.logoDataUri = logo;
  out.spark = spark;
  return out;
}

/** Looks up the card extras for a closed trade. Always resolves (to NO_EXTRAS pieces on failure); bounded by `timeoutMs` overall. */
export function fetchCardExtras(s: TradeStats, opts: { timeoutMs?: number } = {}): Promise<CardExtras> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const key = `${s.tokenAddress ?? ""}:${toEpochMs(s.closedAt)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const work = compute(s, timeoutMs).catch(() => ({ ...NO_EXTRAS }));
  // Overall budget: a slow third party must never hold up a trade card.
  const bounded = Promise.race([work, new Promise<CardExtras>((r) => setTimeout(() => r({ ...NO_EXTRAS }), timeoutMs + 500))]);
  cache.set(key, bounded);
  // A complete result (logo AND chart) is permanent: a closed trade never changes. Anything with a piece missing
  // may just be a transient failure (a rate limit, a slow response), so it's only remembered briefly — it used to
  // be remembered forever whenever either piece had arrived.
  bounded.then((x) => {
    if (!x.logoDataUri || !x.spark) setTimeout(() => cache.delete(key), 60_000);
  });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return bounded;
}
