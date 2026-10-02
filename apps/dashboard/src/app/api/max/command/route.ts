import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";
import { AGENT_REGISTRY } from "@max/shared";
import { getStats } from "@/lib/stats";
import { generateMaxReply } from "@/lib/groq";
import { generateMaxSpeech } from "@/lib/tts";
import { detectCoreCommand } from "@/lib/core-command";
import { isCoreProcessRunning, startCore, stopCore } from "@/lib/core-control";
import { detectAgentCommand, BUILT_AGENT_KEYS, type AgentCommand } from "@/lib/agent-command";

/** Flips Agent.enabled the same way the dashboard toggle does (PATCH /api/agents/[key]). Deterministic confirmation text, never LLM-generated. Unbuilt agents are refused rather than flagged on, since a flag with no runner behind it would be a false "success". */
async function handleAgentCommand({ action, keys }: AgentCommand): Promise<string> {
  const enabled = action === "on";
  const agents = await prisma.agent.findMany({ where: { key: { in: keys } } });
  const changed: string[] = [];
  const unchanged: string[] = [];
  const unbuilt: string[] = [];

  for (const agent of agents) {
    if (enabled && !BUILT_AGENT_KEYS.has(agent.key)) {
      unbuilt.push(agent.name);
      continue;
    }
    if (agent.enabled === enabled) {
      unchanged.push(agent.name);
      continue;
    }
    await prisma.agent.update({ where: { key: agent.key }, data: { enabled, status: enabled ? "idle" : "disabled" } });
    await prisma.activityLog
      .create({ data: { agentKey: "system", level: "info", message: `${enabled ? "Enabled" : "Disabled"} ${agent.name} via MAX command` } })
      .catch(() => {});
    changed.push(agent.name);
  }

  const parts: string[] = [];
  if (changed.length) parts.push(`${enabled ? "Enabled" : "Disabled"} ${changed.join(", ")}.`);
  if (unchanged.length) parts.push(`${unchanged.join(", ")} already ${enabled ? "enabled" : "disabled"}.`);
  if (unbuilt.length) parts.push(`${unbuilt.join(", ")} ${unbuilt.length > 1 ? "aren't" : "isn't"} built yet, so I left ${unbuilt.length > 1 ? "them" : "it"} off.`);
  return parts.join(" ") || "No matching agents found.";
}

/**
 * Routes a typed command to MAX. Real Gemini text generation, grounded with
 * real current DB state (not the model's own guesses) — see lib/gemini.ts.
 * Which agent (if any) is being referenced is decided separately, by plain
 * substring matching against real agent names — simpler and more reliable
 * for that one decision than asking the model to also emit structured
 * output, and it's what actually drives the Stage 2 zoom, so it needs to be
 * deterministic.
 */
/** Runs the actual start/stop and returns the deterministic confirmation text — never LLM-generated, both because there's no need for one here and because the exact phrasing needs to be predictable for this to be trustworthy as a real system action. */
async function handleCoreCommand(action: "on" | "off"): Promise<string> {
  const running = await isCoreProcessRunning();
  if (action === "on") {
    if (running) return "Core is already running.";
    await startCore();
    await prisma.activityLog.create({ data: { agentKey: "system", level: "info", message: "Core start requested via MAX command" } }).catch(() => {});
    return "Core is now starting.";
  }
  if (!running) return "Core is already stopped.";
  await stopCore();
  await prisma.activityLog.create({ data: { agentKey: "system", level: "info", message: "Core stop requested via MAX command" } }).catch(() => {});
  return "Core is now stopped.";
}

export async function POST(req: NextRequest) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const input = (text ?? "").trim();

  // Checked before anything else, and outside the Gemini try/catch below —
  // this is a real system action with a small, hardcoded phrase list (see
  // lib/core-command.ts), not something that should ever depend on an LLM
  // being reachable, or get bundled into that call's own error handling.
  // Agent enable/disable is checked before core: it requires an explicit agent
  // name (or "all agents"), so "shut down Degen Hunter" is claimed here
  // instead of falling into core's bare "shut down" pattern.
  const agentCommand = detectAgentCommand(input);
  const coreAction = agentCommand ? null : detectCoreCommand(input);
  if (agentCommand || coreAction) {
    let spokenText: string;
    try {
      spokenText = agentCommand ? await handleAgentCommand(agentCommand) : await handleCoreCommand(coreAction!);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.activityLog.create({ data: { agentKey: "system", level: "error", message: `${agentCommand ? "Agent" : "Core"} command failed: ${message}` } }).catch(() => {});
      return NextResponse.json({ spokenText: "MAX couldn't complete that command — try again.", targetAgentKey: null, audioDataUrl: null, error: true });
    }
    let audioDataUrl: string | null = null;
    try {
      audioDataUrl = await generateMaxSpeech(spokenText);
    } catch (err) {
      // Best-effort voice, same as the general reply path below — a TTS
      // failure must never block the text confirmation that already
      // succeeded above. This previously logged nothing on failure here,
      // unlike the general path; fixed to match the same "log every TTS
      // failure to the activity feed" pattern in both places.
      const message = err instanceof Error ? err.message : String(err);
      await prisma.activityLog
        .create({ data: { agentKey: "system", level: "warn", message: `MAX voice failed (text reply still shown): ${message}` } })
        .catch(() => {});
    }
    return NextResponse.json({ spokenText, targetAgentKey: null, audioDataUrl, error: false });
  }

  const mentioned = AGENT_REGISTRY.find(
    (a) => input.toLowerCase().includes(a.name.toLowerCase()) || input.toLowerCase().includes(a.key.replace(/-/g, " "))
  );

  let spokenText: string;
  try {
    const [stats, agents] = await Promise.all([getStats(), prisma.agent.findMany()]);
    const enabled = agents.filter((a) => a.enabled);

    const contextBlock = [
      `${stats.agentsActive} of ${stats.agentsTotal} agents enabled: ${enabled.map((a) => a.name).join(", ") || "none"}.`,
      `Watching ${stats.sourcesWatched} sources. ${stats.matchesToday} matches found today.`,
      `Core status: ${stats.coreOnline ? "online" : "offline"}.`,
      stats.recentFailures.length > 0
        ? `Recent errors (last 2h): ${stats.recentFailures.map((f) => `[${f.agentKey}] ${f.message}`).join("; ")}.`
        : "No recent errors.",
      mentioned ? `The user's message appears to reference the "${mentioned.name}" agent — briefly acknowledge you're pulling up its view.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    spokenText = await generateMaxReply(input, contextBlock);
  } catch (err) {
    // Same pattern as every other agent error in this app: logged to the
    // real activity feed, not just a server console — so it's actually
    // visible/diagnosable from the Activity panel, not just this request's
    // own logs.
    const message = err instanceof Error ? err.message : String(err);
    await prisma.activityLog
      .create({ data: { agentKey: "system", level: "error", message: `MAX command failed: ${message}` } })
      .catch(() => {});
    return NextResponse.json({
      spokenText: "MAX couldn't respond — try again.",
      targetAgentKey: null,
      audioDataUrl: null,
      error: true,
    });
  }

  // Voice is best-effort: a TTS failure (rate limit, network) must never
  // block the text reply that already succeeded above.
  let audioDataUrl: string | null = null;
  try {
    audioDataUrl = await generateMaxSpeech(spokenText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.activityLog
      .create({ data: { agentKey: "system", level: "warn", message: `MAX voice failed (text reply still shown): ${message}` } })
      .catch(() => {});
  }

  return NextResponse.json({
    spokenText,
    targetAgentKey: mentioned?.key ?? null,
    audioDataUrl,
    error: false,
  });
}
