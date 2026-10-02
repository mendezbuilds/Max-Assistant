import { NextResponse } from "next/server";
import { prisma } from "@max/db";
import { resolveDegenOwnerChatId } from "@/lib/degen-identity";
import { fetchLivePrices, type LivePrice } from "@/lib/dex-prices";

/**
 * GET /api/agents/degen-hunter/position-marks
 *
 * Open positions with a current mark taken from the agent's own latest token
 * data (DegenHunterRecentToken) — no Solana RPC, so it's cheap enough to poll.
 * Entry market cap isn't stored anywhere; it's derived as currentMarketCap /
 * multiple, which holds as long as supply is constant (market cap ∝ price).
 * If the agent has no recent data for a token, the mark fields are null —
 * never guessed.
 */
export async function GET() {
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [positions, rows] = await Promise.all([
    prisma.degenHunterPosition.findMany({ where: { chatId }, orderBy: { createdAt: "desc" } }),
    prisma.degenHunterRecentToken.findMany({ orderBy: { updatedAt: "desc" }, take: 500 }),
  ]);

  const latest = new Map<string, { priceUsd?: number; marketCapUsd?: number; updatedAt: string }>();
  for (const row of rows) {
    let t: Record<string, unknown>;
    try {
      t = JSON.parse(row.tokenData);
    } catch {
      continue;
    }
    const entry = {
      priceUsd: typeof t.priceUsd === "number" ? t.priceUsd : undefined,
      marketCapUsd: typeof t.marketCapUsd === "number" ? t.marketCapUsd : undefined,
      updatedAt: row.updatedAt.toISOString(),
    };
    const addr = typeof t.contractAddress === "string" ? t.contractAddress : undefined;
    // rows are newest-first, so the first sighting of an address is its latest mark
    if (addr && !latest.has(addr)) latest.set(addr, entry);
    if (!latest.has(row.tokenId)) latest.set(row.tokenId, entry);
  }

  // Realized-PnL columns (added after the Prisma client was generated, hence raw SQL).
  const pnlRows = await prisma
    .$queryRawUnsafe<{ id: number; realizedSOL: number; exitPriceUsd: number | null; closedAt: string | null }[]>(
      `SELECT id, realizedSOL, exitPriceUsd, closedAt FROM "DegenHunterPosition" WHERE chatId = ?`,
      chatId
    )
    .catch(() => []);
  const pnlById = new Map(pnlRows.map((r) => [Number(r.id), r]));

  // Live prices for everything currently held or watched, straight from DexScreener.
  // The scanner's cached price (above) is only a fallback — it's nothing at all for a
  // token the scanner hasn't recently seen, which is exactly what you tend to have bought.
  const live = await fetchLivePrices(positions.filter((p) => p.status === "OPEN").map((p) => p.tokenAddress)).catch(() => new Map<string, LivePrice>());

  const marks = positions.map((p) => {
    const entryPriceUsd = Number(p.entryPriceUsd);
    const liveMark = live.get(p.tokenAddress);
    const mark = liveMark
      ? { priceUsd: liveMark.priceUsd, marketCapUsd: liveMark.marketCapUsd, updatedAt: new Date().toISOString() }
      : latest.get(p.tokenAddress);
    const currentPriceUsd = mark?.priceUsd ?? null;
    const multiple = currentPriceUsd != null && entryPriceUsd > 0 ? currentPriceUsd / entryPriceUsd : null;
    const currentMarketCapUsd = mark?.marketCapUsd ?? null;

    const pnl = pnlById.get(p.id);
    const realizedSOL = pnl ? Number(pnl.realizedSOL) : 0;
    const amountSOL = Number(p.amountSOL);
    const closed = p.status === "CLOSED";
    // Open + partially sold: the original token count isn't stored, so the value
    // of what's left (and so an honest unrealized PnL) can't be worked out. Say
    // so (partial) and report only what's known.
    const partial = !closed && realizedSOL > 0;
    const realized = closed && pnl?.exitPriceUsd != null
      ? { multiple: realizedSOL / amountSOL, pnlSOL: realizedSOL - amountSOL, pnlPct: (realizedSOL / amountSOL - 1) * 100 }
      : null;
    return {
      realizedSOL,
      exitPriceUsd: pnl?.exitPriceUsd ?? null,
      closedAt: pnl?.closedAt ?? null,
      hasCard: realized != null,
      realized,
      partial,
      unrealizedSOL: !closed && !partial && multiple != null ? amountSOL * (multiple - 1) : null,
      id: p.id,
      tokenAddress: p.tokenAddress,
      tokenSymbol: p.tokenSymbol,
      status: p.status,
      amountSOL: Number(p.amountSOL),
      entryPriceUsd,
      createdAt: p.createdAt.toISOString(),
      currentPriceUsd,
      currentMarketCapUsd,
      entryMarketCapUsd: currentMarketCapUsd != null && multiple ? currentMarketCapUsd / multiple : null,
      multiple,
      markedAt: mark?.updatedAt ?? null,
    };
  });

  // Watchlist performance, as last computed by core's scan (lastMultiple / ruggedAt).
  // Raw SQL: these columns postdate the generated Prisma client.
  const watchRows = await prisma
    .$queryRawUnsafe<{ tokenAddress: string; tokenSymbol: string | null; tokenName: string | null; lastMultiple: number | null; ruggedAt: string | null }[]>(
      `SELECT tokenAddress, tokenSymbol, tokenName, lastMultiple, ruggedAt FROM "DegenHunterWatchlist" WHERE chatId = ?`,
      chatId
    )
    .catch(() => []);
  const watch = watchRows.map((w) => {
    const multiple = w.lastMultiple == null ? null : Number(w.lastMultiple);
    const mark = latest.get(w.tokenAddress);
    const currentMarketCapUsd = mark?.marketCapUsd ?? null;
    return {
      tokenAddress: w.tokenAddress,
      symbol: w.tokenSymbol ?? w.tokenName ?? w.tokenAddress.slice(0, 6),
      multiple,
      rugged: w.ruggedAt != null,
      currentMarketCapUsd,
      entryMarketCapUsd: currentMarketCapUsd != null && multiple ? currentMarketCapUsd / multiple : null,
    };
  });

  return NextResponse.json({ marks, watch });
}
