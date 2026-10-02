import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { prisma } from "@max/db";
import { computeTradeStats, renderTradeCardSvg, fetchCardExtras, type CardExtras, type TradeStats } from "@max/shared";

/**
 * Realized-PnL bookkeeping for positions, and the closed-trade card.
 *
 * The three columns involved (realizedSOL, exitPriceUsd, closedAt) were added
 * by a migration after the Prisma client was last generated, so they're read
 * and written with raw SQL — the typed client doesn't know them yet.
 */

/** Geist, bundled in packages/shared so card text looks the same on every machine (see assets/fonts/README.md). */
const FONT_FILE = path.resolve(__dirname, "../../../../../../packages/shared/assets/fonts/Geist-Regular.ttf");

/**
 * Records what a sell actually returned. `solReceived` accumulates across
 * partial sells; when the sell closes the position, the exit price (the sell's
 * own price: SOL out × SOL/USD ÷ tokens sold, the same basis as the entry
 * price) and the close time are stored too.
 */
export async function recordSell(opts: {
  positionId: number;
  solReceived: number;
  tokensSold: number;
  solUsd: number;
  closed: boolean;
}): Promise<void> {
  const { positionId, solReceived, tokensSold, solUsd, closed } = opts;
  if (!(solReceived >= 0)) return;
  if (closed) {
    const exitPrice = tokensSold > 0 ? (solReceived * solUsd) / tokensSold : null;
    await prisma.$executeRawUnsafe(
      `UPDATE "DegenHunterPosition" SET realizedSOL = realizedSOL + ?, exitPriceUsd = ?, closedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      solReceived, exitPrice, positionId
    );
  } else {
    await prisma.$executeRawUnsafe(`UPDATE "DegenHunterPosition" SET realizedSOL = realizedSOL + ? WHERE id = ?`, solReceived, positionId);
  }
}

interface PositionRow {
  tokenSymbol: string;
  tokenAddress: string;
  amountSOL: number;
  entryPriceUsd: number;
  realizedSOL: number;
  exitPriceUsd: number | null;
  createdAt: string;
  closedAt: string | null;
  status: string;
}

/** Stats for a closed position, or null if it isn't closed or has no recorded exit (e.g. it was closed before PnL tracking existed). */
export async function getClosedTradeStats(positionId: number): Promise<TradeStats | null> {
  const rows = await prisma.$queryRawUnsafe<PositionRow[]>(
    `SELECT tokenSymbol, tokenAddress, amountSOL, entryPriceUsd, realizedSOL, exitPriceUsd, createdAt, closedAt, status FROM "DegenHunterPosition" WHERE id = ?`,
    positionId
  );
  const p = rows[0];
  if (!p || p.status !== "CLOSED" || p.exitPriceUsd == null || p.closedAt == null) return null;
  return computeTradeStats({
    symbol: p.tokenSymbol,
    tokenAddress: p.tokenAddress,
    entryPriceUsd: Number(p.entryPriceUsd),
    exitPriceUsd: Number(p.exitPriceUsd),
    investedSOL: Number(p.amountSOL),
    proceedsSOL: Number(p.realizedSOL),
    openedAt: p.createdAt,
    closedAt: p.closedAt,
  });
}

export type CardBackground = "transparent" | "dark";

export function renderTradeCardPng(stats: TradeStats, extras?: Partial<CardExtras>, background: CardBackground = "transparent"): Buffer {
  const svg = renderTradeCardSvg(stats, extras, { background });
  return new Resvg(svg, {
    font: { fontFiles: [FONT_FILE], loadSystemFonts: false, defaultFontFamily: "Geist" },
  })
    .render()
    .asPng();
}

/**
 * The full card: looks up the token's logo and a real price sparkline (a few seconds at most, cached
 * per trade) and renders with whatever came back. Never throws on a lookup failure — the card just
 * comes out without that piece.
 */
export async function buildTradeCardPng(stats: TradeStats, background: CardBackground = "transparent"): Promise<Buffer> {
  const extras = await fetchCardExtras(stats); // cached per trade, so a second render (other background) costs only the draw
  return renderTradeCardPng(stats, extras, background);
}

/** One-line caption to go with the card. */
export function tradeCaption(s: TradeStats): string {
  if (s.flat) return `➖ $${s.symbol} closed flat — ${s.multiple.toFixed(2)}× (0.0%), 0 SOL`;
  const sign = s.pnlSOL > 0 ? "+" : "−";
  return `${s.win ? "✅" : "🔻"} $${s.symbol} closed — ${s.multiple.toFixed(2)}× (${sign}${Math.abs(s.pnlPct).toFixed(1)}%), ${sign}${Math.abs(s.pnlSOL).toFixed(4)} SOL`;
}
