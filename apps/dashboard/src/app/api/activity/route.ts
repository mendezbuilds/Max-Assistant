import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";

/** Recent activity log entries for the side panel's Activity mode. */
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 200);

  const entries = await prisma.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(entries);
}
