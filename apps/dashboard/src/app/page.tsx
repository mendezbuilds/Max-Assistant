import { prisma } from "@max/db";
import { AgentCard, type AgentCardData } from "@/components/AgentCard";
import { ActivityFeed, type ActivityEntry } from "@/components/ActivityFeed";

export const dynamic = "force-dynamic"; // always read current DB state, no static caching

export default async function DashboardPage() {
  const [agents, activity] = await Promise.all([
    prisma.agent.findMany({ orderBy: [{ phase: "asc" }, { name: "asc" }] }),
    prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);

  const agentCards: AgentCardData[] = agents.map((a) => ({
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

  const activityEntries: ActivityEntry[] = activity.map((a) => ({
    id: a.id,
    agentKey: a.agentKey,
    level: a.level,
    message: a.message,
    createdAt: a.createdAt.toISOString(),
  }));

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-50">Max</h1>
          <p className="text-sm text-neutral-500">Personal AI agent hub</p>
        </div>
        <form action="/api/logout" method="POST">
          <button className="text-sm text-neutral-500 hover:text-neutral-300">Log out</button>
        </form>
      </header>

      <section className="mb-10 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Activity
        </h2>
        <ActivityFeed entries={activityEntries} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Agents
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agentCards.map((agent) => (
            <AgentCard key={agent.key} agent={agent} />
          ))}
        </div>
      </section>
    </main>
  );
}
