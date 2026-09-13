import { prisma } from "@max/db";
import { getStats } from "@/lib/stats";
import { HqDashboard } from "@/components/hq/HqDashboard";
import type { AgentData } from "@/components/hq/types";

export const dynamic = "force-dynamic"; // always read current DB state, no static caching

export default async function DashboardPage() {
  const [agents, stats] = await Promise.all([
    prisma.agent.findMany({ orderBy: [{ phase: "asc" }, { name: "asc" }] }),
    getStats(),
  ]);

  const agentData: AgentData[] = agents.map((a) => ({
    key: a.key,
    name: a.name,
    icon: a.icon,
    description: a.description,
    phase: a.phase,
    enabled: a.enabled,
    status: a.status,
    lastActionAt: a.lastActionAt?.toISOString() ?? null,
    lastActionSummary: a.lastActionSummary,
  }));

  return <HqDashboard initialAgents={agentData} initialStats={stats} />;
}
