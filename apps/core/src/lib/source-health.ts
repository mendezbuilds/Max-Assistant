/**
 * Tracks consecutive failures per (agent, source) so a source that's failing
 * run after run gets flagged distinctly from a one-off blip — "degraded",
 * not just another identical warning line. In-memory only: resets on
 * process restart, so it answers "has this been failing across the recent
 * cycles this process has been up for", not a durable historical record.
 * That's an intentional scope limit, not an oversight — durable tracking
 * would mean a new DB table, which felt like more than a logging tweak
 * warranted; revisit if that distinction turns out to matter.
 */

const DEGRADED_THRESHOLD = 3;

interface HealthState {
  consecutiveFailures: number;
  lastErrorMessage?: string;
}

const state = new Map<string, HealthState>();

function key(agentKey: string, sourceName: string): string {
  return `${agentKey}:${sourceName}`;
}

/**
 * Records one source's fetch outcome. Returns "degraded" the moment
 * consecutive failures cross the threshold (so the caller can log that
 * transition distinctly, once, rather than repeating "degraded" every run).
 */
export function recordSourceResult(
  agentKey: string,
  sourceName: string,
  outcome: { ok: true } | { ok: false; errorMessage: string }
): "ok" | "failed" | "degraded" {
  const k = key(agentKey, sourceName);
  const current = state.get(k) ?? { consecutiveFailures: 0 };

  if (outcome.ok) {
    state.set(k, { consecutiveFailures: 0 });
    return "ok";
  }

  const consecutiveFailures = current.consecutiveFailures + 1;
  state.set(k, { consecutiveFailures, lastErrorMessage: outcome.errorMessage });
  return consecutiveFailures >= DEGRADED_THRESHOLD ? "degraded" : "failed";
}

export function getConsecutiveFailures(agentKey: string, sourceName: string): number {
  return state.get(key(agentKey, sourceName))?.consecutiveFailures ?? 0;
}
