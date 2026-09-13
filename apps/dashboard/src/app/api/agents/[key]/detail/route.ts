import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";
import { isRunSummaryMessage } from "@/lib/activity-parse";

/** Rich per-agent data for the orbit's click-to-zoom detail screen. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [agent, todayLogs, recentErrors, recentActivity] = await Promise.all([
    prisma.agent.findUnique({ where: { key } }),
    prisma.activityLog.findMany({
      where: { agentKey: key, createdAt: { gte: startOfToday }, level: "info" },
    }),
    prisma.activityLog.findMany({
      where: { agentKey: key, level: { in: ["warn", "error"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.activityLog.findMany({
      where: { agentKey: key },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const runsToday = todayLogs.filter((log) => isRunSummaryMessage(log.message)).length;

  return NextResponse.json({
    agent,
    runsToday,
    recentErrors,
    recentActivity,
  });
}
