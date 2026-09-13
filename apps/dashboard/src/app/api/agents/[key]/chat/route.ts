import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";
import { isRunSummaryMessage } from "@/lib/activity-parse";

/**
 * A themed reply from one specific agent — NOT a real LLM call (see the
 * matching comment on /api/max/command/route.ts for why). This builds a
 * templated response from that agent's real current state (status, last
 * result, recent errors), with light per-agent phrasing, so it's grounded
 * in genuine data even though there's no model behind the wording yet.
 * Navigation words ("close"/"back"/"exit") are handled client-side before
 * this route is ever called — see the command bar's local check.
 */
const TONE: Record<string, string> = {
  "job-scout": "Scanning boards on schedule.",
  "alpha-scout": "Eyes on-chain and off.",
  "wl-hunter": "Watching the gates for you.",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [agent, todayLogs, recentErrors] = await Promise.all([
    prisma.agent.findUnique({ where: { key } }),
    prisma.activityLog.findMany({ where: { agentKey: key, createdAt: { gte: startOfToday }, level: "info" } }),
    prisma.activityLog.findMany({
      where: { agentKey: key, level: { in: ["warn", "error"] } },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
  ]);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const runsToday = todayLogs.filter((log) => isRunSummaryMessage(log.message)).length;
  const tone = TONE[key] ?? "Standing by.";

  const lines = [`${agent.name} here. ${tone}`];
  lines.push(
    agent.enabled ? `Status: ${agent.status}, ${runsToday} run(s) today.` : "I'm currently disabled — enable me on the dashboard to get going."
  );
  if (agent.lastActionSummary) lines.push(`Last: ${agent.lastActionSummary}`);
  if (recentErrors.length > 0) {
    lines.push(`Heads up — ${recentErrors.length} recent issue(s): ${recentErrors[0].message}`);
  }
  if (text) lines.push(`("${text}" noted — I'm not running on a real model yet, so this is as clever as I get for now.)`);

  return NextResponse.json({ reply: lines.join("\n") });
}
