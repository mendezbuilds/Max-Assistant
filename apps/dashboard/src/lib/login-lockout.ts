import { prisma, logActivity } from "@max/db";

/**
 * Brute-force protection for the dashboard login password. Same thresholds as the
 * Degen Hunter PIN lockout (5 failures → 15 minutes) and the same fix for its
 * race condition: attempts are CLAIMED atomically before the password is checked.
 *
 * Why the claim has to be atomic: a read-the-counter / check-the-password /
 * write-counter+1 sequence lets N simultaneous guesses all read "0 failures", all
 * pass the lock check and all be checked (tested on the PIN version: 200 at once →
 * 200 checked, no lock). Here each attempt first wins a compare-and-swap on the
 * counter in a single SQL UPDATE; only the winner may check the password, and
 * everyone else re-reads and is rejected once the budget is spent.
 *
 * Scope: ONE global counter, not one per IP. The dashboard has no trusted proxy,
 * so X-Forwarded-For is attacker-controlled and a per-IP limit would be bypassed
 * by changing a header. The cost is that someone hammering the login can lock the
 * owner out for 15 minutes; the Telegram bot and everything else is unaffected.
 *
 * Raw SQL: the LoginLockout table postdates the generated Prisma client, and
 * $executeRaw returns the affected-row count, which is exactly the CAS result.
 */
const KEY = "dashboard-login";
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export type LoginCheck =
  | { ok: true }
  | { ok: false; reason: "locked"; retryInMinutes: number }
  | { ok: false; reason: "incorrect"; attemptsRemaining: number; justLocked: boolean };

interface Row {
  failedAttempts: number | bigint;
  lockedUntil: number | bigint | null;
}

/**
 * @param isCorrect  checks the submitted password. Only ever called by the caller
 *                   that wins an attempt slot — never during a lockout.
 */
export async function loginWithLockout(isCorrect: () => Promise<boolean>): Promise<LoginCheck> {
  for (let tries = 0; tries < 25; tries++) {
    await prisma.$executeRawUnsafe(`INSERT OR IGNORE INTO "LoginLockout" ("key", "failedAttempts", "lockedUntil") VALUES (?, 0, NULL)`, KEY);
    const rows = await prisma.$queryRawUnsafe<Row[]>(`SELECT "failedAttempts", "lockedUntil" FROM "LoginLockout" WHERE "key" = ?`, KEY);
    const failed = Number(rows[0]?.failedAttempts ?? 0);
    const lockedUntil = rows[0]?.lockedUntil == null ? null : Number(rows[0].lockedUntil);

    const now = Date.now();
    if (lockedUntil !== null && lockedUntil > now) {
      return { ok: false, reason: "locked", retryInMinutes: Math.max(1, Math.ceil((lockedUntil - now) / 60000)) };
    }

    // This attempt would be failure number `next`. If that's the last one allowed, the lock is set as part of the
    // claim itself (counter reset so the window after expiry starts fresh). The attempt that took the last slot is
    // still checked below, and if it's the correct password the lock is cleared again.
    const next = failed + 1;
    const locksNow = next >= MAX_ATTEMPTS;
    const newLockedUntil = locksNow ? now + LOCKOUT_MS : null;

    // Compare-and-swap in one statement. `IS` is NULL-safe equality, so this matches both "no lock" and "an expired lock".
    const claimed = await prisma.$executeRawUnsafe(
      `UPDATE "LoginLockout" SET "failedAttempts" = ?, "lockedUntil" = ? WHERE "key" = ? AND "failedAttempts" = ? AND "lockedUntil" IS ?`,
      locksNow ? 0 : next, newLockedUntil, KEY, failed, lockedUntil
    );
    if (claimed === 0) continue; // another attempt changed the state first: re-read and re-decide

    // We own this attempt slot, and the counter already reflects it.
    if (await isCorrect()) {
      await prisma.$executeRawUnsafe(`UPDATE "LoginLockout" SET "failedAttempts" = 0, "lockedUntil" = NULL WHERE "key" = ?`, KEY);
      return { ok: true };
    }

    if (locksNow) {
      // Never log the attempted password — only that a lockout happened.
      await logActivity(
        "system",
        "warn",
        `Dashboard login locked after ${MAX_ATTEMPTS} consecutive failed attempts — locked until ${new Date(newLockedUntil!).toISOString()}`
      ).catch(() => {});
    }
    return { ok: false, reason: "incorrect", attemptsRemaining: locksNow ? 0 : MAX_ATTEMPTS - next, justLocked: locksNow };
  }

  // Too much contention to claim a slot: reject without checking (fail closed).
  return { ok: false, reason: "locked", retryInMinutes: 1 };
}
