/**
 * Best-effort extraction of a deadline-looking snippet from free text — for
 * flagging, not for parsing into an actual Date (formats are too varied:
 * "ends Sept 30", "48 hours left", "until further notice", "closes when
 * 10,000 slots are filled"). Returns the surrounding snippet as-is so a
 * human can read it, rather than trying to normalize it into a hard date.
 *
 * Shared by alpha-scout (testnet/airdrop task windows) and nft-whitelist
 * (WL application windows) — moved here from alpha-scout once a second
 * agent needed the same thing.
 */
const DEADLINE_PATTERN = /\b(deadline|ends?|expires?|closes?|until|last day)\b[^.\n]{0,80}/i;

export function detectDeadline(text: string): string | undefined {
  const match = text.match(DEADLINE_PATTERN);
  return match?.[0]?.trim();
}
