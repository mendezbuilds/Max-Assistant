import { NextRequest, NextResponse } from "next/server";
import { prisma, logActivity } from "@max/db";

/**
 * "Run now" on an agent's dashboard card. This only sets a flag — apps/core
 * (a separate process, sharing just the DB) polls for it every ~10s and
 * actually runs the agent; see apps/core/src/scheduler.ts's
 * checkManualTriggers. That poll interval is why a click won't feel
 * perfectly instant, but it means this route stays as simple as the
 * existing enable/disable toggle rather than needing a new way for these
 * two processes to talk to each other.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const agent = await prisma.agent.findUnique({ where: { key } });

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  if (!agent.enabled) {
    return NextResponse.json({ error: "Agent is disabled — enable it first" }, { status: 400 });
  }

  const updated = await prisma.agent.update({
    where: { key },
    data: { triggerRequestedAt: new Date() },
  });

  // Logged under "system", not the agent's own key: this is a request, not
  // a result, and logging it as the agent's own activity would update its
  // lastActionAt/lastActionSummary immediately — which is exactly what the
  // dashboard's completion-polling watches for, so it'd read the request as
  // an already-finished run. The agent's own genuine completion log (from
  // the actual run, moments later) is what should move that.
  await logActivity("system", "info", `Manual run requested for ${agent.name} from the dashboard`);

  return NextResponse.json(updated);
}
