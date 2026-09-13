import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";
import { AGENT_REGISTRY } from "@max/shared";
import { totalSourceCount } from "@/lib/hq-config";
import { extractSentCount, isRunSummaryMessage } from "@/lib/activity-parse";

/**
 * Routes a typed command to MAX. This is NOT a real LLM call — no agent in
 * this codebase calls Claude yet (ANTHROPIC_API_KEY is unused everywhere;
 * see SPEC.md), and wiring that up is a backend change outside a UI-only
 * build. This does simple substring matching against real agent names, and
 * builds its spoken summary from real DB stats — genuinely live data, just
 * not an LLM behind it.
 */
export async function POST(req: NextRequest) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const input = (text ?? "").toLowerCase().trim();

  const mentioned = AGENT_REGISTRY.find(
    (a) => input.includes(a.name.toLowerCase()) || input.includes(a.key.replace(/-/g, " "))
  );

  if (mentioned) {
    return NextResponse.json({
      spokenText: `Pulling up ${mentioned.name} now.`,
      targetAgentKey: mentioned.key,
    });
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [agents, todayLogs] = await Promise.all([
    prisma.agent.findMany(),
    prisma.activityLog.findMany({ where: { createdAt: { gte: startOfToday }, level: "info" } }),
  ]);

  const enabledKeys = agents.filter((a) => a.enabled).map((a) => a.key);
  const matchesToday = todayLogs
    .filter((log) => isRunSummaryMessage(log.message))
    .reduce((sum, log) => sum + extractSentCount(log.message), 0);

  const spokenText =
    `${enabledKeys.length} of ${agents.length} agents active, ` +
    `watching ${totalSourceCount(enabledKeys)} sources. ` +
    (matchesToday > 0
      ? `${matchesToday} matches found today.`
      : "Nothing new found yet today.");

  return NextResponse.json({ spokenText, targetAgentKey: null });
}
