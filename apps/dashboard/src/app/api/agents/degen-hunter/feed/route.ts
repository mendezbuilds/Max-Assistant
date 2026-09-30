import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";

/**
 * GET /api/agents/degen-hunter/feed
 *
 * Returns parsed DegenToken records stored in DegenHunterRecentToken.
 * Supports:
 *   - limit (max 100, default 50)
 *   - afterId (cursor-based pagination)
 *
 * The tokenData field is JSON-encoded; we parse it safely before returning.
 * Missing/invalid fields are preserved as-is — never fabricated.
 */
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 100);
  const afterId = Number(req.nextUrl.searchParams.get("afterId")) || 0;

  try {
    const rows = await prisma.degenHunterRecentToken.findMany({
      where: afterId > 0 ? { id: { gt: afterId } } : undefined,
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    const tokens = rows.map((row) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(row.tokenData);
      } catch {
        parsed = {};
      }

      return {
        _rowId: row.id,
        _updatedAt: row.updatedAt.toISOString(),
        tokenId: row.tokenId,
        // Spread the full parsed token data
        ...parsed,
      };
    });

    return NextResponse.json({ tokens, count: tokens.length });
  } catch (error) {
    console.error("[api/agents/degen-hunter/feed] Error:", error);
    return NextResponse.json({ error: "Failed to fetch token feed" }, { status: 500 });
  }
}
