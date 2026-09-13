/**
 * Poll intervals, mirrored from apps/core/src/scheduler.ts's cron.schedule()
 * calls — kept here rather than imported, since the dashboard doesn't
 * depend on apps/core's code. Update both places together if a cron
 * interval changes; this is a UI-only build, not a shared-config refactor.
 */
export const AGENT_POLL_MINUTES: Record<string, number> = {
  "job-scout": 30,
  "alpha-scout": 20,
  "wl-hunter": 20,
};

export const HEARTBEAT_MINUTES = 15;

/** Next time a "every N minutes" cron (node-cron semantics: fires when minute % N === 0) will fire after `from`. */
export function nextCronFire(from: Date, everyMinutes: number): Date {
  const next = new Date(from);
  next.setSeconds(0, 0);
  const currentMinute = next.getMinutes();
  const remainder = currentMinute % everyMinutes;
  const minutesToAdd = remainder === 0 ? everyMinutes : everyMinutes - remainder;
  next.setMinutes(currentMinute + minutesToAdd);
  return next;
}
