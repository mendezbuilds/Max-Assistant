import cron from "node-cron";
import { log } from "./logger";

/**
 * Phase 0 has no real agents yet, so this just proves the pattern future
 * agents will register into: a cron job that does work, then logs through
 * the shared logger (which also updates the dashboard + can call notify()).
 *
 * Real agents (Phase 1+) should each get their own cron.schedule() call here
 * (or move to their own module imported from here), gated by the Agent's
 * `enabled` flag in the DB so the dashboard toggle actually does something.
 */
export function startScheduler() {
  // Every 15 minutes: a heartbeat so "is core actually alive" is answerable
  // from the activity feed alone, without SSH-ing into the box.
  cron.schedule("*/15 * * * *", async () => {
    await log("system", "info", "heartbeat — Max core is alive");
  });

  console.log("[scheduler] started (heartbeat every 15m)");
}
