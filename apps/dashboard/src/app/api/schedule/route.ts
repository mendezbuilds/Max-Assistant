import { NextResponse } from "next/server";
import { prisma } from "@max/db";
import { AGENT_POLL_MINUTES, HEARTBEAT_MINUTES, nextCronFire } from "@/lib/schedule";

/**
 * Upcoming scheduled items for the side panel's Schedule mode. Only real
 * system poll cycles exist right now — no agent drafts content yet (per the
 * brief: "where an agent has no real drafted content system yet, show
 * system tasks only"). Computed from apps/core's known cron intervals, not
 * queried from a live scheduler — apps/core's own process is the only thing
 * that actually knows its precise cron state, and this is a UI-only build.
 */
export async function GET() {
  const now = new Date();
  const agents = await prisma.agent.findMany({ where: { enabled: true } });

  const items = agents
    .filter((a) => AGENT_POLL_MINUTES[a.key] !== undefined)
    .map((a) => ({
      kind: "poll" as const,
      agentKey: a.key,
      agentName: a.name,
      nextRunAt: nextCronFire(now, AGENT_POLL_MINUTES[a.key]),
      draftContent: null as string | null, // no content-drafting system exists yet
    }));

  items.push({
    kind: "poll",
    agentKey: "system",
    agentName: "Heartbeat",
    nextRunAt: nextCronFire(now, HEARTBEAT_MINUTES),
    draftContent: null,
  });

  items.sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime());

  return NextResponse.json(items);
}
