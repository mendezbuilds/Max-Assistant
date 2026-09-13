import { logActivity, type LogLevel } from "@max/db";

/**
 * Thin wrapper around @max/db's logActivity that also echoes to the console
 * — every agent (and core itself) should log through here rather than
 * console.log alone, since this is what feeds the dashboard's activity feed.
 */
export async function log(
  agentKey: string,
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>
) {
  console.log(`[${level.toUpperCase()}] [${agentKey}] ${message}`);
  await logActivity(agentKey, level, message, meta);
}
