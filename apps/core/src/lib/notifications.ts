import { logActivity } from "@max/db";
import { type LogLevel } from "@max/db";

/**
 * Publishes an alert event that will be picked up by the MAX HQ Toaster UI.
 * Wraps logActivity to cleanly attach the isAlert flag.
 */
export async function publishAlert(
  agentKey: string,
  type: string,
  message: string,
  level: LogLevel = "info",
  extraMeta?: Record<string, unknown>
) {
  const meta = {
    isAlert: true,
    type,
    ...extraMeta,
  };

  // console.log to match the core logger behavior
  console.log(`[ALERT] [${agentKey}] [${type}] ${message}`);
  
  await logActivity(agentKey, level, message, meta);
}
