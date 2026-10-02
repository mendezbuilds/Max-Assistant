import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";

export async function GET(req: NextRequest) {
  const afterId = Number(req.nextUrl.searchParams.get("afterId")) || 0;
  // `limit` means "the newest N". It used to be ignored, so a first load got the OLDEST 50 alerts and every later
  // poll walked forward through history, replaying old alerts one batch at a time.
  const limitParam = Number(req.nextUrl.searchParams.get("limit")) || 0;
  const limit = limitParam > 0 ? Math.min(limitParam, 50) : 0;
  
  // Fetch activity logs that have the isAlert metadata flag
  const entries = await prisma.activityLog.findMany({
    where: {
      id: { gt: afterId },
      // Since SQLite Prisma doesn't support JSON path queries perfectly in string fields,
      // and we just need a simple flag, we can use a basic contains check. 
      // The backend will write '{"isAlert":true' or similar.
      meta: {
        contains: '"isAlert":true',
      }
    },
    orderBy: { id: limit ? "desc" : "asc" },
    take: limit || 50,
  });

  // Always oldest -> newest, so the last row is the newest (clients use it as their cursor).
  return NextResponse.json(limit ? entries.reverse() : entries);
}
