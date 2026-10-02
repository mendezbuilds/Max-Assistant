/**
 * Tunables for Degen Hunter's transient live-alert display. These only affect
 * what the live streaming view shows — every underlying record (tokens in
 * DegenHunterRecentToken, ActivityLog alerts, positions) is untouched, so the
 * Alerts tab and Activity feed remain the permanent history.
 *
 * Override at build/dev time with NEXT_PUBLIC_* env vars (the live view runs in
 * the browser, so server-only vars wouldn't reach it). Static references to
 * process.env.NEXT_PUBLIC_X are required for Next to inline them.
 */
function num(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}

/** How long each card stays on screen before fading out on its own timer. */
// Default 10 min. New tokens only turn up every several minutes, and anything
// older than this on arrival is skipped as stale — at the earlier 4 min the
// panel was empty most of the time even though the agent was finding tokens.
export const ALERT_TTL_MS = num(process.env.NEXT_PUBLIC_DEGEN_ALERT_TTL_SECONDS, 600) * 1000;
/** Max cards visible at once; the oldest is pushed out first if the cap is hit before its own timer. */
export const ALERT_MAX_VISIBLE = num(process.env.NEXT_PUBLIC_DEGEN_ALERT_MAX_VISIBLE, 6);
/** Length of the fade-out before a card is removed. */
export const ALERT_FADE_MS = 400;
/** How often the live stream polls for new data. */
export const ALERT_POLL_MS = 20_000;

/** Tracking updates fire on an open position once it is at least this multiple of entry (then again every TRACKING_STEP). */
export const TRACKING_MIN_MULTIPLE = 1.5;
export const TRACKING_STEP = 0.5;
/** Exit signal fires on an open position at or below this multiple of entry (0.6 = down 40%). */
export const EXIT_MULTIPLE = num(process.env.NEXT_PUBLIC_DEGEN_EXIT_MULTIPLE, 0.6);
/** A position at or below this multiple counts as rugged on the Overview stat card. */
export const RUG_MULTIPLE = 0.1;
