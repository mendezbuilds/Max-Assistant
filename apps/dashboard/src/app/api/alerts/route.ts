import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";

export async function GET(req: NextRequest) {
  const afterId = Number(req.nextUrl.searchParams.get("afterId")) || 0;
  
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
    orderBy: { id: "asc" },
    take: 50,
  });

  return NextResponse.json(entries);
}
