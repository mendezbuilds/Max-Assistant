import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { Resvg } from "@resvg/resvg-js";
import { prisma } from "@max/db";
import { computeTradeStats, renderTradeCardSvg, fetchCardExtras } from "@max/shared";
import { resolveDegenOwnerChatId } from "@/lib/degen-identity";

/**
 * GET /api/agents/degen-hunter/trade-card?id=<positionId>[&download=1]
 *
 * The closed-trade card as a PNG: X, %, entry → exit price, SOL in/out. Owner
 * only, and only for the owner's own closed positions. Positions closed before
 * PnL tracking existed have no recorded exit, so there's nothing to draw.
 */
export async function GET(req: NextRequest) {
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const rows = await prisma.$queryRawUnsafe<
    { tokenSymbol: string; tokenAddress: string; amountSOL: number; entryPriceUsd: number; realizedSOL: number; exitPriceUsd: number | null; createdAt: string; closedAt: string | null; status: string }[]
  >(
    `SELECT tokenSymbol, tokenAddress, amountSOL, entryPriceUsd, realizedSOL, exitPriceUsd, createdAt, closedAt, status FROM "DegenHunterPosition" WHERE id = ? AND chatId = ?`,
    id, chatId
  );
  const p = rows[0];
  if (!p) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  if (p.status !== "CLOSED" || p.exitPriceUsd == null || p.closedAt == null) {
    return NextResponse.json({ error: "No closed-trade data recorded for this position" }, { status: 404 });
  }

  const stats = computeTradeStats({
    symbol: p.tokenSymbol,
    tokenAddress: p.tokenAddress,
    entryPriceUsd: Number(p.entryPriceUsd),
    exitPriceUsd: Number(p.exitPriceUsd),
    investedSOL: Number(p.amountSOL),
    proceedsSOL: Number(p.realizedSOL),
    openedAt: p.createdAt,
    closedAt: p.closedAt,
  });

  // Geist ships in packages/shared. MAX_REPO_ROOT is set by next.config.js — a
  // __dirname here would resolve inside Next's bundle, not the repo.
  const root = process.env.MAX_REPO_ROOT ?? path.resolve(process.cwd(), "..", "..");
  const fontFile = path.join(root, "packages", "shared", "assets", "fonts", "Geist-Regular.ttf");

  // A closed trade never changes, so its finished card is remembered: reopening or downloading it is instant. A card
  // that came out missing a piece (a lookup failed or was rate-limited) is only reused for a minute, so a later view retries.
  // The version prefix is bumped whenever the card's look changes, so a PNG rendered by an older design is never served again.
  // v4: the card is a transparent PNG (nothing outside its rounded corners), cleanly clipped.
  const cacheKey = `card-v6-borderless:${id}:${p.closedAt}`;
  let entry = pngCache.get(cacheKey);
  if (!entry || (!entry.complete && Date.now() - entry.at > 60_000)) {
    // The token's logo and a real price sparkline for the trade (bounded to a few seconds; the card just
    // comes out without a piece that can't be fetched).
    const extras = await fetchCardExtras(stats);
    const png = new Resvg(renderTradeCardSvg(stats, extras), {
      font: { fontFiles: [fontFile], loadSystemFonts: false, defaultFontFamily: "Geist" },
    })
      .render()
      .asPng();
    entry = { png, at: Date.now(), complete: !!(extras.logoDataUri && extras.spark) };
    pngCache.set(cacheKey, entry);
    if (pngCache.size > 50) pngCache.delete(pngCache.keys().next().value as string);
  }

  const headers: Record<string, string> = { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" };
  if (req.nextUrl.searchParams.get("download")) {
    headers["Content-Disposition"] = `attachment; filename="${p.tokenSymbol.replace(/[^\w-]/g, "")}-trade.png"`;
  }
  return new NextResponse(new Uint8Array(entry.png), { headers });
}

const pngCache = new Map<string, { png: Uint8Array; at: number; complete: boolean }>();
