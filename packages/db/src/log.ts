import { prisma } from "./client";

export type LogLevel = "info" | "warn" | "error";

/**
 * Shared by apps/core (agent runs, heartbeats) and apps/dashboard (e.g. "user
 * toggled an agent on/off") — anything that writes to the central activity
 * feed should go through here, so the feed and each Agent card's "last
 * action" stay consistent no matter which app made the change.
 *
 * agentKey should match a key in packages/shared/src/agents.config.ts, or be
 * "system" for hub-level events not tied to one agent.
 */
export async function logActivity(
  agentKey: string,
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>
) {
  await prisma.activityLog.create({
    data: {
      agentKey,
      level,
      message,
      meta: meta ? JSON.stringify(meta) : undefined,
    },
  });

  if (agentKey !== "system") {
    await prisma.agent
      .update({
        where: { key: agentKey },
        data: {
          lastActionAt: new Date(),
          lastActionSummary: message,
          status: level === "error" ? "error" : "idle",
        },
      })
      .catch(() => {
        // Agent row doesn't exist (typo'd key, or roster not seeded yet).
        // Don't let a logging call crash the caller over that.
      });
  }
}
