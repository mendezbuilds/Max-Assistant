import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";

/**
 * GET /api/agents/degen-hunter/risk
 *
 * Returns parsed DegenToken records specifically for the risk workspace.
 * Pulls from the recent token cache and exposes all fields so the client
 * can group, sort, and filter by risk level and flags.
 */
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 200, 500);

  try {
    const rows = await prisma.degenHunterRecentToken.findMany({
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
        ...parsed,
      };
    });

    return NextResponse.json({ tokens, count: tokens.length });
  } catch (error) {
    console.error("[api/agents/degen-hunter/risk] Error:", error);
    return NextResponse.json({ error: "Failed to fetch risk data" }, { status: 500 });
  }
}
