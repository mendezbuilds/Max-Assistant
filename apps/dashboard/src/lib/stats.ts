import { prisma } from "@max/db";
import { totalSourceCount } from "./hq-config";
import { extractSentCount, isRunSummaryMessage } from "./activity-parse";

/** Shared by the initial server-rendered page and the client-polled /api/stats route, so the query logic lives in exactly one place. */
export async function getStats() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [agents, todayLogs, recentFailures, lastBoot, lastHeartbeat] = await Promise.all([
    prisma.agent.findMany(),
    prisma.activityLog.findMany({
      where: { createdAt: { gte: startOfToday }, level: "info" },
    }),
    prisma.activityLog.findMany({
      where: {
        level: { in: ["warn", "error"] },
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.activityLog.findFirst({
      where: { agentKey: "system", message: "Max core started" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.activityLog.findFirst({
      where: { agentKey: "system", message: { contains: "heartbeat" } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const coreOnline = Boolean(
    lastHeartbeat && Date.now() - lastHeartbeat.createdAt.getTime() < 20 * 60 * 1000
  );

  const enabledKeys = agents.filter((a) => a.enabled).map((a) => a.key);
  const matchesToday = todayLogs
    .filter((log) => isRunSummaryMessage(log.message))
    .reduce((sum, log) => sum + extractSentCount(log.message), 0);

  return {
    agentsActive: enabledKeys.length,
    agentsTotal: agents.length,
    sourcesWatched: totalSourceCount(enabledKeys),
    matchesToday,
    apiCreditRemaining: null as number | null,
    coreOnline,
    bootedAt: lastBoot?.createdAt.toISOString() ?? null,
    recentFailures: recentFailures.map((f) => ({
      id: f.id,
      agentKey: f.agentKey,
      level: f.level,
      message: f.message,
      createdAt: f.createdAt.toISOString(),
    })),
  };
}
