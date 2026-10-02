import crypto from "crypto";
import { requireEnv } from "./env";
import { prisma } from "@max/db";

/**
 * Single source of truth for Degen Hunter's wallet encryption and PIN
 * hashing — previously duplicated (copy-pasted, not imported) across
 * apps/core's telegram bot and four separate dashboard API routes, which
 * had silently drifted to include a hardcoded fallback encryption key
 * baked into source (`sha256("degen-hunter-fallback-development-key-only")`)
 * used whenever WALLET_ENCRYPTION_KEY was unset. Since that var was never
 * actually set in .env, every wallet encrypted so far used that public,
 * in-source key — anyone with this repo could decrypt any wallet. Fixed by
 * requiring the real key and throwing (not warning) if it's missing or
 * malformed, and by having every call site import from here instead of
 * keeping its own copy.
 */
function getEncryptionKey(): Buffer {
  const envKey = requireEnv("WALLET_ENCRYPTION_KEY");
  if (envKey.length === 64) return Buffer.from(envKey, "hex");
  if (envKey.length === 32) return Buffer.from(envKey, "utf-8");
  throw new Error(
    "WALLET_ENCRYPTION_KEY must be a 64-character hex string (32 random bytes) or a 32-character UTF-8 string — got length " +
      envKey.length
  );
}

export function encryptPrivateKey(privateKeyBase58: string): { encryptedKey: string; iv: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(privateKeyBase58, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return {
    encryptedKey: encrypted + ":" + authTag,
    iv: iv.toString("hex"),
  };
}

export function decryptPrivateKey(encryptedKeyWithTag: string, ivHex: string): string | null {
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");

    const parts = encryptedKeyWithTag.split(":");
    if (parts.length !== 2) throw new Error("Invalid encrypted key format");

    const [encrypted, authTag] = parts;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(Buffer.from(authTag, "hex"));

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("[degen-crypto] Failed to decrypt private key:", error);
    return null;
  }
}

// ─── PIN Hashing & Verification ───────────────────────────────────────────────
// PBKDF2-SHA256, 100k iterations, random salt, timing-safe compare. (Not
// bcrypt, despite what an earlier schema comment claimed.)

const PIN_SALT_LENGTH = 16;
const PIN_HASH_ITERATIONS = 100_000;

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(PIN_SALT_LENGTH);
  const hash = crypto.pbkdf2Sync(pin, salt, PIN_HASH_ITERATIONS, 32, "sha256");
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/**
 * Expects storedHash in format: salt:hash (both hex encoded). NOT exported on purpose: it checks a PIN with no
 * attempt tracking, so calling it directly would bypass the brute-force lockout. Use verifyPinWithLockout.
 */
function verifyPin(pin: string, storedHash: string): boolean {
  try {
    const [saltHex, hashHex] = storedHash.split(":");
    if (!saltHex || !hashHex) return false;

    const salt = Buffer.from(saltHex, "hex");
    const hashBuffer = Buffer.from(hashHex, "hex");
    const computedHash = crypto.pbkdf2Sync(pin, salt, PIN_HASH_ITERATIONS, 32, "sha256");

    if (computedHash.length !== hashBuffer.length) return false;
    return crypto.timingSafeEqual(computedHash, hashBuffer);
  } catch (error) {
    console.error("[degen-crypto] Error verifying PIN:", error);
    return false;
  }
}

// ─── PIN brute-force lockout ──────────────────────────────────────────────────

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export type PinCheckResult =
  | { ok: true }
  | { ok: false; reason: "no_user" }
  | { ok: false; reason: "no_pin_set" }
  | { ok: false; reason: "locked"; retryAt: Date; retryInMinutes: number }
  | { ok: false; reason: "incorrect"; attemptsRemaining: number; justLocked: boolean };

/**
 * The single PIN-verification entry point for every PIN-gated Degen Hunter
 * action — trades, sends, wallet deletion, deposits/withdrawals, PIN
 * changes, key export — across both the Telegram bot (9 call sites) and
 * the 4 dashboard API routes that check a PIN. Previously every one of
 * those ~13 sites called the bare verifyPin() above directly with no
 * attempt tracking at all: a 4-digit PIN (10,000 combinations) could be
 * brute-forced with unlimited guesses.
 *
 * Failures are tracked on DegenHunterUser, keyed by chatId — the one
 * identity this whole feature already keys everything on — and are
 * shared across ALL PIN-gated actions for that user, not counted
 * separately per action. A per-action counter would let an attacker
 * rotate through the 13 entry points for 13x the real attempt budget;
 * one shared counter closes that off. During a lockout, the PIN itself
 * is never even checked — reason "locked" is returned immediately.
 */
export async function verifyPinWithLockout(chatId: string, pin: string): Promise<PinCheckResult> {
  // Claiming an attempt is a compare-and-swap on the counter, and ONLY the caller that wins the claim is allowed to
  // check the PIN. The previous version read the counter, checked the PIN, then wrote counter+1 — so N guesses
  // sent at once all read "0 failures", all passed the lock check, and all were checked, while the counter only
  // moved to 1 and no lock was ever set (tested: 200 simultaneous guesses → 200 checked, 0 locked). Here the
  // claim is atomic: concurrent callers lose the swap, re-read the new counter/lock, and are rejected once the
  // budget is spent. Retries are bounded; a caller starved by contention is rejected without being checked.
  for (let tries = 0; tries < 25; tries++) {
    const user = await prisma.degenHunterUser.findUnique({ where: { chatId } });
    if (!user) return { ok: false, reason: "no_user" };
    if (!user.pinHash) return { ok: false, reason: "no_pin_set" };

    const now = new Date();
    if (user.pinLockedUntil && user.pinLockedUntil > now) {
      const retryInMinutes = Math.max(1, Math.ceil((user.pinLockedUntil.getTime() - now.getTime()) / 60000));
      return { ok: false, reason: "locked", retryAt: user.pinLockedUntil, retryInMinutes };
    }

    // This attempt would be failure number `next`. If that is the last one allowed, the lock is set as part of the
    // claim itself (and the counter reset so the window after expiry starts fresh). The attempt that took the last
    // slot is still checked below, and if it turns out to be the correct PIN the lock is cleared again.
    const next = user.pinFailedAttempts + 1;
    const locksNow = next >= PIN_MAX_ATTEMPTS;
    const lockedUntil = locksNow ? new Date(now.getTime() + PIN_LOCKOUT_MS) : null;

    const claimed = await prisma.degenHunterUser.updateMany({
      where: { chatId, pinFailedAttempts: user.pinFailedAttempts, pinLockedUntil: user.pinLockedUntil },
      data: { pinFailedAttempts: locksNow ? 0 : next, pinLockedUntil: lockedUntil },
    });
    if (claimed.count === 0) continue; // another attempt changed the counter first: re-read and re-decide

    // We own this attempt slot, and the counter already reflects it.
    if (verifyPin(pin, user.pinHash)) {
      await prisma.degenHunterUser.updateMany({ where: { chatId }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
      return { ok: true };
    }

    if (locksNow) {
      // Never log the PIN value itself — only that a lockout occurred.
      await prisma.activityLog
        .create({
          data: {
            agentKey: "degen-hunter",
            level: "warn",
            message: `PIN locked for chatId ${chatId} after ${PIN_MAX_ATTEMPTS} consecutive failed attempts — locked until ${lockedUntil!.toISOString()}`,
          },
        })
        .catch(() => {});
    }

    return { ok: false, reason: "incorrect", attemptsRemaining: locksNow ? 0 : PIN_MAX_ATTEMPTS - next, justLocked: locksNow };
  }

  // Too much contention to claim a slot: reject without checking the PIN (fail closed).
  return { ok: false, reason: "locked", retryAt: new Date(Date.now() + 60_000), retryInMinutes: 1 };
}
