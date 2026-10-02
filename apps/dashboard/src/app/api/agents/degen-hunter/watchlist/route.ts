import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";
import { resolveDegenOwnerChatId } from "@/lib/degen-identity";

const NOT_MAPPED = {
  error: "identity_not_mapped",
  message:
    "DEGEN_OWNER_CHAT_ID is not configured. Set it in .env to your Telegram chatId to link your bot watchlist to the dashboard.",
} as const;

/** GET /api/agents/degen-hunter/watchlist — list the owner's watched tokens */
export async function GET(_req: NextRequest) {
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) {
    return NextResponse.json(NOT_MAPPED, { status: 401 });
  }

  try {
    const rows = await prisma.degenHunterWatchlist.findMany({
      where: { chatId },
      orderBy: { addedAt: "desc" },
    });

    // For each watchlist entry, try to find the corresponding token data
    const enriched = await Promise.all(
      rows.map(async (row) => {
        // Look up the token data from the recent token cache
        const recentToken = await prisma.degenHunterRecentToken.findFirst({
          where: {
            OR: [
              { tokenId: row.tokenAddress },
              // tokenData may contain contractAddress — check via JSON search
              { tokenData: { contains: row.tokenAddress } },
            ],
          },
          orderBy: { updatedAt: "desc" },
        });

        let tokenData: Record<string, unknown> = {};
        if (recentToken) {
          try {
            tokenData = JSON.parse(recentToken.tokenData);
          } catch {
            tokenData = {};
          }
        }

        return {
          tokenAddress: row.tokenAddress,
          addedAt: row.addedAt.toISOString(),
          tokenData: Object.keys(tokenData).length > 0 ? tokenData : null,
        };
      })
    );

    return NextResponse.json({ watchlist: enriched, count: enriched.length });
  } catch (error) {
    console.error("[watchlist GET]", error);
    return NextResponse.json({ error: "Failed to fetch watchlist" }, { status: 500 });
  }
}

/** POST /api/agents/degen-hunter/watchlist — add a token to watchlist */
export async function POST(req: NextRequest) {
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) {
    return NextResponse.json(NOT_MAPPED, { status: 401 });
  }

  let tokenAddress: string;
  try {
    const body = await req.json();
    tokenAddress = String(body.tokenAddress ?? "").trim();
    if (!tokenAddress) throw new Error("missing tokenAddress");
  } catch {
    return NextResponse.json({ error: "tokenAddress is required" }, { status: 400 });
  }

  try {
    await prisma.degenHunterWatchlist.upsert({
      where: { chatId_tokenAddress: { chatId, tokenAddress } },
      update: { addedAt: new Date() },
      create: { chatId, tokenAddress },
    });

    // Record the price at the moment of adding — the "1×" that the watchlist's
    // X-milestone and rug alerts measure against (see core's watchlistMonitor).
    // Only fills a missing baseline, so re-watching never resets it. Raw SQL
    // because these columns postdate the generated Prisma client.
    try {
      const row = await prisma.degenHunterRecentToken.findFirst({
        where: { tokenData: { contains: tokenAddress } },
        orderBy: { updatedAt: "desc" },
      });
      const price = row ? Number((JSON.parse(row.tokenData) as { priceUsd?: number }).priceUsd) : NaN;
      if (price > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "DegenHunterWatchlist" SET baselinePriceUsd = ? WHERE chatId = ? AND tokenAddress = ? AND baselinePriceUsd IS NULL`,
          price, chatId, tokenAddress
        );
      }
    } catch { /* no baseline now; core picks one up on its next scan */ }

    // Fire global alert
    await prisma.activityLog.create({
      data: {
        agentKey: "degen-hunter",
        level: "info",
        message: `Added to Watchlist: ${tokenAddress.slice(0,8)}...`,
        meta: JSON.stringify({ isAlert: true, type: "watchlist", tokenAddress })
      }
    });

    return NextResponse.json({ success: true, tokenAddress });
  } catch (error) {
    console.error("[watchlist POST]", error);
    return NextResponse.json({ error: "Failed to add to watchlist" }, { status: 500 });
  }
}
