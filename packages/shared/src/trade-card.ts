import { toEpochMs, type CardExtras } from "./trade-card-data";

/**
 * PnL math and the closed-trade card, shared by apps/core (sends the card to
 * Telegram) and apps/dashboard (shows/downloads it).
 *
 * Pure on purpose — numbers in, numbers/SVG text out, no I/O and no native
 * dependencies — so either app can import it. Optional extras (logo, chain,
 * price sparkline) are fetched separately (trade-card-data.ts) and passed in.
 * Turning the SVG into a PNG needs a native rasterizer, which each app does itself.
 */

type DateLike = Date | number | string;

export interface ClosedTradeInput {
  symbol: string;
  /** The token's mint address. Optional: only used to look up the logo and price history for the card. */
  tokenAddress?: string;
  /** Token price (USD) when bought. */
  entryPriceUsd: number;
  /** Token price (USD) of the sell that closed the position. */
  exitPriceUsd: number;
  /** SOL spent opening the position. */
  investedSOL: number;
  /** Total SOL received across every sell of the position (partial sells included). */
  proceedsSOL: number;
  openedAt: DateLike;
  closedAt: DateLike;
}

export interface TradeStats extends ClosedTradeInput {
  /** proceeds ÷ invested — what the money actually did, fees and slippage included. 3.2 means 3.2×. */
  multiple: number;
  /** (multiple − 1) × 100. */
  pnlPct: number;
  /** proceeds − invested, in SOL. */
  pnlSOL: number;
  /** Closed with a profit (strictly more SOL out than in). */
  win: boolean;
  /** Closed even (within dust): neither a win nor a loss, so the card goes neutral instead of green. */
  flat: boolean;
  heldMs: number;
}

/** Differences smaller than this (0.000001 SOL) count as breaking even, not as a win or a loss. */
const FLAT_EPSILON_SOL = 1e-6;

/**
 * Headline numbers for a closed trade. The multiple is measured on SOL in vs
 * SOL out (not on the two token prices) because that's what the wallet really
 * gained or lost; for a single full sell the two agree.
 */
export function computeTradeStats(t: ClosedTradeInput): TradeStats {
  const multiple = t.investedSOL > 0 ? t.proceedsSOL / t.investedSOL : 0;
  return {
    ...t,
    multiple,
    pnlPct: (multiple - 1) * 100,
    pnlSOL: t.proceedsSOL - t.investedSOL,
    win: Math.abs(t.proceedsSOL - t.investedSOL) >= FLAT_EPSILON_SOL && t.proceedsSOL > t.investedSOL,
    flat: Math.abs(t.proceedsSOL - t.investedSOL) < FLAT_EPSILON_SOL,
    // toEpochMs reads the database's "YYYY-MM-DD HH:MM:SS" timestamps as the UTC they are; plain new Date() would
    // read them in the machine's local time zone and get "held for" wrong anywhere that isn't UTC.
    heldMs: Math.max(0, toEpochMs(t.closedAt) - toEpochMs(t.openedAt)),
  };
}

/** Unrealized PnL (SOL) of an open position that's currently worth `multiple` × what was put in. */
export function unrealizedPnlSOL(investedSOL: number, multiple: number): number {
  return investedSOL * (multiple - 1);
}

export function formatPrice(n: number | null | undefined): string {
  if (n == null || !(n > 0)) return "—";
  if (n >= 1) return `$${n.toFixed(2)}`;
  // Plain decimals with 4 significant digits ($0.00002896, not 3e-5 or $0.000029) — meme-coin prices
  // move in the 3rd-4th digit, so rounding earlier hides real change.
  const decimals = Math.min(12, Math.max(4, -Math.floor(Math.log10(n)) + 3));
  return `$${n.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function formatSol(n: number, signed = false): string {
  const s = Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(Math.abs(n) >= 1 ? 3 : 4);
  return `${signed && n > 0 ? "+" : ""}${s}`;
}

export function formatHeld(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c] as string));
}

// Win uses MAX's own identity colors (the teal/blue-gray of MAX's core and the dashboard's #7fd9d8 accent), so a
// winning card reads as unmistakably MAX rather than a generic green-means-win card. Losses stay red, breakeven grey.
const WIN = "#7fd9d8";
const LOSS = "#f43f5e";
const FLAT = "#94a3b8";

/** The hero number's gradient: win teal → brighter teal; loss red → orange; flat stays in greys. */
const HERO_GRADIENT = {
  win: ["#4fb0b0", "#d3f7f4"],
  loss: ["#f43f5e", "#fb923c"],
  flat: ["#64748b", "#cbd5e1"],
} as const;

/** Tabler's "flame" outline (24×24), the icon used for Degen Hunter elsewhere in the dashboard. */
const FLAME_PATH = "M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z";

/** Tabler's "brain" outline (24×24): the icon MAX's core uses throughout the dashboard. Drawn huge and faint as a watermark. */
const BRAIN_PATHS = [
  "M15.5 13a3.5 3.5 0 0 0 -3.5 3.5v1a3.5 3.5 0 0 0 7 0v-1.8",
  "M8.5 13a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1 -7 0v-1.8",
  "M17.5 16a3.5 3.5 0 0 0 0 -7h-.5",
  "M19 9.3v-2.8a3.5 3.5 0 0 0 -7 0",
  "M6.5 16a3.5 3.5 0 0 1 0 -7h.5",
  "M5 9.3v-2.8a3.5 3.5 0 0 1 7 0v10",
];
/** MAX's brand teal, used for the watermark whatever the trade's outcome — the brand doesn't change with the result. */
const MAX_TEAL = "#7fd9d8";

/** Celebratory badge, only for genuinely strong wins. */
function milestone(s: TradeStats): string | null {
  if (!s.win) return null;
  if (s.multiple >= 10) return "10X+";
  if (s.multiple >= 5) return "5X+";
  if (s.multiple >= 3) return "3X+";
  return null;
}

/** Real price points → an SVG line, a filled area beneath it, and the two end points. */
function sparkGeometry(values: number[], x: number, y: number, w: number, h: number) {
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [x + (i / (values.length - 1)) * w, y + h - ((v - min) / span) * h] as const);
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const area = `${line} L${(x + w).toFixed(1)},${y + h} L${x},${y + h} Z`;
  return { line, area, first: pts[0], last: pts[pts.length - 1] };
}

/**
 * The card. A dark panel with a win/loss/flat accent: gradient hero number, a glowing
 * accent border, the token's logo and chain, a real-data sparkline of the trade, a milestone
 * badge for big wins, and MAX's brain as a faint watermark. Fixed 900×520. Uses the "Geist"
 * family with generic fallbacks — the rasterizer is handed the Geist font file.
 *
 * The data on the card (multiple, %, entry/exit, IN/OUT/PNL, hold time, close date) and
 * the win/loss/flat logic are unchanged; `extras` only adds optional visuals and any piece
 * that is missing is simply left out.
 */
export function renderTradeCardSvg(
  s: TradeStats,
  extras: Partial<CardExtras> = {},
  opts: {
    /**
     * What is outside the card's rounded corners. "transparent" (default): nothing — the PNG has real alpha and the
     * card floats on whatever it's shown on. "dark": a solid near-black canvas, for places that flatten transparency
     * onto a colour of their own (e.g. Telegram's inline photos).
     */
    background?: "transparent" | "dark";
  } = {}
): string {
  const solidCanvas = opts.background === "dark";
  const kind = s.flat ? "flat" : s.win ? "win" : "loss";
  const accent = s.flat ? FLAT : s.win ? WIN : LOSS;
  const [heroFrom, heroTo] = HERO_GRADIENT[kind];
  const multipleText = `${s.multiple >= 10 ? s.multiple.toFixed(0) : s.multiple.toFixed(2)}×`;
  // + for a gain, − (a real minus sign) for a loss, no sign at all for exactly flat
  const pctText = `${s.flat ? "" : s.pnlPct > 0 ? "+" : "−"}${Math.abs(s.pnlPct).toFixed(1)}%`;
  const closed = new Date(toEpochMs(s.closedAt)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const font = `Geist, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
  const label = (x: number, y: number, text: string) =>
    `<text x="${x}" y="${y}" font-family="${font}" font-size="12" letter-spacing="2.4" fill="#6f8581">${text}</text>`;

  // ── identity: avatar + symbol + chain ──
  // Token symbols are arbitrary text. Keep only characters the bundled font can draw (Latin), so an emoji or
  // exotic-script symbol can't render as blank boxes; if nothing is left, show the start of the address.
  const drawable = s.symbol.replace(/[^ -~ -ɏ]/g, "").trim();
  const shown = drawable || (s.tokenAddress ? s.tokenAddress.slice(0, 6) : "TOKEN");
  const symbol = `$${esc(shown)}`;
  const initial = esc((shown[0] ?? "?").toUpperCase());
  const avatar = extras.logoDataUri
    ? `<clipPath id="av"><circle cx="78" cy="118" r="26"/></clipPath>
  <image href="${extras.logoDataUri}" x="52" y="92" width="52" height="52" preserveAspectRatio="xMidYMid slice" clip-path="url(#av)"/>
  <circle cx="78" cy="118" r="26" fill="none" stroke="${accent}" stroke-opacity="0.7" stroke-width="1.8"/>`
    : `<circle cx="78" cy="118" r="26" fill="url(#avFallback)"/>
  <text x="78" y="128" text-anchor="middle" font-family="${font}" font-size="26" fill="#e8f0ed">${initial}</text>
  <circle cx="78" cy="118" r="26" fill="none" stroke="${accent}" stroke-opacity="0.7" stroke-width="1.8"/>`;
  const symbolX = 116;
  // The badge sits after the symbol, so it needs the symbol's real width: capitals are much wider than lowercase (a flat 20px
  // per character put the badge on top of "$AUTONOM"). Approximate Geist's widths at 34px.
  const symbolW = ("$" + shown).split("").reduce((w, c) => w + (/[A-Z$@MW%&]/.test(c) ? 25 : /[il.,'!|1:; ]/.test(c) ? 10 : 20), 0);
  const chainX = symbolX + symbolW + 16;
  const chain = (extras.chain ?? "").toLowerCase();
  const chainBadge = chain
    ? `<g transform="translate(${chainX} 102)">
    <rect width="${chain === "solana" ? 98 : 16 + chain.length * 9.5 + 18}" height="28" rx="14" fill="#ffffff" fill-opacity="0.06" stroke="#ffffff" stroke-opacity="0.14"/>
    ${
      chain === "solana"
        ? `<g transform="translate(12 6.5) scale(0.6)"><path d="M4 0H24L20 5H0Z" fill="url(#sol)"/><path d="M0 7.5H20L24 12.5H4Z" fill="url(#sol)"/><path d="M4 15H24L20 20H0Z" fill="url(#sol)"/></g>
    <text x="32" y="18.5" font-family="${font}" font-size="11.5" letter-spacing="1.8" fill="#c9d6d2">SOLANA</text>`
        : `<text x="14" y="18.5" font-family="${font}" font-size="11.5" letter-spacing="1.8" fill="#c9d6d2">${esc(chain.toUpperCase())}</text>`
    }
  </g>`
    : "";

  // ── milestone badge (genuinely big wins only) ──
  const badge = milestone(s);
  const bw = badge ? badge.length * 12.5 + 52 : 0;
  const badgeSvg = badge
    ? `<g transform="translate(${848 - bw} 32)">
    <rect width="${bw}" height="36" rx="18" fill="${accent}" fill-opacity="0.15" stroke="${accent}" stroke-opacity="0.6" stroke-width="1.4"/>
    <g transform="translate(12 6) scale(0.96)"><path d="${FLAME_PATH}" fill="${accent}" fill-opacity="0.95"/></g>
    <text x="40" y="24.5" font-family="${font}" font-size="16" letter-spacing="1.4" fill="${accent}">${badge}</text>
  </g>`
    : "";

  // ── sparkline: real candles only, in the free space beside the percentage pill ──
  const sp = extras.spark && extras.spark.length >= 5 ? sparkGeometry(extras.spark, 300, 272, 280, 32) : null;
  const sparkSvg = sp
    ? `<path d="${sp.area}" fill="url(#sparkFill)"/>
  <path d="${sp.line}" fill="none" stroke="${accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${sp.first[0]}" cy="${sp.first[1]}" r="3.8" fill="#0a1011" stroke="#cfdcd7" stroke-width="1.5"/>
  <circle cx="${sp.last[0]}" cy="${sp.last[1]}" r="6.5" fill="${accent}" fill-opacity="0.25"/>
  <circle cx="${sp.last[0]}" cy="${sp.last[1]}" r="3.6" fill="${accent}"/>
  <text x="300" y="322" font-family="${font}" font-size="10.5" letter-spacing="2" fill="#566b67">ENTRY → EXIT</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="520" viewBox="0 0 900 520">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f191b"/><stop offset="1" stop-color="#0a1011"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${accent}" stop-opacity="0.30"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <radialGradient id="glow2" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${accent}" stop-opacity="0.14"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <!-- MAX's core sphere: the dashboard's exact gradient (#4a7a80 → #1a2a2c), fading out at the rim -->
    <radialGradient id="core" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="#4a7a80" stop-opacity="0.9"/><stop offset="0.75" stop-color="#1a2a2c" stop-opacity="0.55"/><stop offset="1" stop-color="#1a2a2c" stop-opacity="0"/></radialGradient>
    <linearGradient id="hero" x1="0" y1="0" x2="1" y2="0.35"><stop offset="0" stop-color="${heroFrom}"/><stop offset="1" stop-color="${heroTo}"/></linearGradient>
    <linearGradient id="borderGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity="0.95"/><stop offset="0.55" stop-color="${accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${accent}" stop-opacity="0.75"/></linearGradient>
    <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity="0.30"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></linearGradient>
    <linearGradient id="avFallback" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity="0.45"/><stop offset="1" stop-color="#101a1c"/></linearGradient>
    <linearGradient id="sol" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9945FF"/><stop offset="1" stop-color="#14F195"/></linearGradient>
    <filter id="blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="9"/></filter>
    <clipPath id="cardShape"><rect width="900" height="520"/></clipPath>
  </defs>

  ${solidCanvas ? `<!-- dark canvas, for apps that flatten transparency onto a colour of their own -->\n  <rect width="900" height="520" fill="#070c0d"/>` : "<!-- transparent canvas: nothing is drawn outside the card's rounded shape -->"}
  <rect width="900" height="520" fill="url(#bg)"/>
  <!-- Glows and the watermark are clipped to the card's rounded shape, so none of it bleeds into the corners outside it. -->
  <g clip-path="url(#cardShape)">
  <circle cx="780" cy="70" r="270" fill="url(#glow)"/>
  <circle cx="90" cy="500" r="220" fill="url(#glow2)"/>

  <!-- MAX watermark: the core sphere with its brain, large and faint, behind the data (brand, not content) -->
  <circle cx="742" cy="338" r="196" fill="url(#core)" opacity="0.22"/>
  <g transform="translate(532 128) scale(17.5)" opacity="0.052" fill="none" stroke="${MAX_TEAL}" stroke-width="0.55" stroke-linecap="round" stroke-linejoin="round">
    ${BRAIN_PATHS.map((d) => `<path d="${d}"/>`).join("\n    ")}
  </g>
  </g>


  <!-- header: flame + label -->
  <g transform="translate(50 36) scale(1.05)"><path d="${FLAME_PATH}" fill="none" stroke="${accent}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></g>
  <text x="82" y="55" font-family="${font}" font-size="13" letter-spacing="3.2" fill="${accent}">DEGEN HUNTER · CLOSED TRADE</text>
  ${badgeSvg}

  <!-- identity -->
  ${avatar}
  <text x="${symbolX}" y="129" font-family="${font}" font-size="34" fill="#e8f0ed">${symbol}</text>
  ${chainBadge}

  <!-- the number -->
  <text x="52" y="250" font-family="${font}" font-size="98" fill="url(#hero)">${multipleText}</text>
  <rect x="56" y="268" width="${pctText.length * 20 + 30}" height="42" rx="21" fill="${accent}" fill-opacity="0.15" stroke="${accent}" stroke-opacity="0.3"/>
  <text x="72" y="297" font-family="${font}" font-size="25" fill="${accent}">${pctText}</text>
  ${sparkSvg}

  <!-- IN / OUT / PNL -->
  ${label(640, 190, "IN")}
  <text x="640" y="216" font-family="${font}" font-size="21" fill="#cfdcd7">${formatSol(s.investedSOL)} SOL</text>
  ${label(640, 250, "OUT")}
  <text x="640" y="276" font-family="${font}" font-size="21" fill="#cfdcd7">${formatSol(s.proceedsSOL)} SOL</text>
  ${label(640, 310, "PNL")}
  <text x="640" y="340" font-family="${font}" font-size="24" fill="${accent}">${formatSol(s.pnlSOL, true)} SOL</text>

  <!-- entry → exit -->
  ${label(52, 392, "ENTRY")}
  <text x="52" y="422" font-family="${font}" font-size="22" fill="#cfdcd7">${formatPrice(s.entryPriceUsd)}</text>
  <text x="272" y="422" font-family="${font}" font-size="22" fill="${accent}">→</text>
  ${label(316, 392, "EXIT")}
  <text x="316" y="422" font-family="${font}" font-size="22" fill="#cfdcd7">${s.exitPriceUsd === 0 ? "$0" : formatPrice(s.exitPriceUsd)}</text>

  <!-- footer -->
  <line x1="52" y1="452" x2="848" y2="452" stroke="${accent}" stroke-opacity="0.14"/>
  <text x="52" y="486" font-family="${font}" font-size="14" fill="#566b67">Held ${formatHeld(s.heldMs)}  ·  Closed ${closed}</text>
  <g transform="translate(848 486)">
    <text text-anchor="end" font-family="${font}" font-size="11.5" letter-spacing="2.8" fill="#6f8581" fill-opacity="0.9">MADE BY MENDEZ</text>
    <path d="M-160 -4 l4.5 -4.5 l4.5 4.5 l-4.5 4.5 Z" fill="${accent}" fill-opacity="0.7"/>
  </g>
</svg>`;
}
