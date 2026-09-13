/**
 * Extracts a "how many matches/leads did this run send" count from an
 * agent's own run-summary log line. This is text-parsing against the exact
 * message formats apps/core's agents log today (see runJobScout /
 * runAlphaScout / runNftWhitelistHunter) — fragile in the sense that it
 * needs updating if those message formats change, but avoids touching
 * apps/core to add structured fields for what is otherwise a UI-only build.
 * If parsing ever fails to match, this returns 0 rather than throwing —
 * a stat silently reading low is better than the dashboard erroring.
 */
export function extractSentCount(message: string): number {
  // job-scout: "...X private match(es), Y public match(es)"
  const jobScout = message.match(/(\d+)\s+private match\(es\).*?(\d+)\s+public match\(es\)/);
  if (jobScout) return Number(jobScout[1]) + Number(jobScout[2]);

  // alpha-scout / wl-hunter: "X new signal(s) sent" / "X new lead(s) sent"
  const sent = message.match(/(\d+)\s+new (?:signal|lead)\(s\) sent/);
  if (sent) return Number(sent[1]);

  return 0;
}

/** True for a run's own summary line (as opposed to a per-source warning, a heartbeat, etc.) — used to count "runs today". */
export function isRunSummaryMessage(message: string): boolean {
  return /^Checked \d+ sources/.test(message);
}
