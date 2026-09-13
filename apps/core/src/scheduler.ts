import cron from "node-cron";
import { prisma } from "@max/db";
import { log } from "./logger";
import { AGENT_RUNNERS } from "./agents/registry";

/**
 * Each real agent gets its own cron.schedule() call here, gated by the
 * Agent's `enabled` flag in the DB so the dashboard toggle actually does
 * something. Errors are caught per-agent so one agent misbehaving can't take
 * the whole scheduler down.
 */
async function runIfEnabled(agentKey: string, run: () => Promise<void>) {
  const agent = await prisma.agent.findUnique({ where: { key: agentKey } });
  if (!agent?.enabled) return;

  try {
    await run();
  } catch (err) {
    await log(agentKey, "error", `Run failed: ${(err as Error).message}`);
  }
}

/**
 * A dashboard "Run now" click (or `npm run trigger:*`, though that path runs
 * directly instead — see cli/trigger.ts) sets Agent.triggerRequestedAt.
 * Polled on a short interval rather than via cron, since cron here only
 * runs at minute granularity and a manual trigger should feel close to
 * instant. Clears the flag before running so a slow run can't leave it set
 * long enough to be picked up a second time.
 */
async function checkManualTriggers() {
  for (const agentKey of Object.keys(AGENT_RUNNERS)) {
    const agent = await prisma.agent.findUnique({ where: { key: agentKey } });
    if (!agent?.triggerRequestedAt) continue;

    await prisma.agent.update({ where: { key: agentKey }, data: { triggerRequestedAt: null } });

    if (!agent.enabled) continue; // shouldn't happen (the API route checks this too), but don't run a disabled agent

    // Logged under "system" — see the matching comment in the dashboard's
    // trigger route for why this can't be logged under agentKey itself.
    await log("system", "info", `Manual run triggered for ${agentKey} (dashboard)`);
    await runIfEnabled(agentKey, AGENT_RUNNERS[agentKey]);
  }
}

export function startScheduler() {
  // Every 15 minutes: a heartbeat so "is core actually alive" is answerable
  // from the activity feed alone, without SSH-ing into the box.
  cron.schedule("*/15 * * * *", async () => {
    await log("system", "info", "heartbeat — Max core is alive");
  });

  // Job boards don't move fast enough to justify polling more often than this.
  cron.schedule("*/30 * * * *", () => runIfEnabled("job-scout", AGENT_RUNNERS["job-scout"]));

  setInterval(checkManualTriggers, 10_000);

  console.log(
    "[scheduler] started (heartbeat every 15m, job-scout every 30m when enabled, manual triggers polled every 10s)"
  );
}
