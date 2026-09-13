import cron from "node-cron";
import { prisma } from "@max/db";
import { log } from "./logger";
import { runJobScout } from "./agents/job-scout";

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

export function startScheduler() {
  // Every 15 minutes: a heartbeat so "is core actually alive" is answerable
  // from the activity feed alone, without SSH-ing into the box.
  cron.schedule("*/15 * * * *", async () => {
    await log("system", "info", "heartbeat — Max core is alive");
  });

  // Job boards don't move fast enough to justify polling more often than this.
  cron.schedule("*/30 * * * *", () => runIfEnabled("job-scout", runJobScout));

  console.log("[scheduler] started (heartbeat every 15m, job-scout every 30m when enabled)");
}
