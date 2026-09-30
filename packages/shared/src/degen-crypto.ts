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

/** Expects storedHash in format: salt:hash (both hex encoded). */
export function verifyPin(pin: string, storedHash: string): boolean {
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
  const user = await prisma.degenHunterUser.findUnique({ where: { chatId } });
  if (!user) return { ok: false, reason: "no_user" };
  if (!user.pinHash) return { ok: false, reason: "no_pin_set" };

  const now = new Date();
  if (user.pinLockedUntil && user.pinLockedUntil > now) {
    const retryInMinutes = Math.max(1, Math.ceil((user.pinLockedUntil.getTime() - now.getTime()) / 60000));
    return { ok: false, reason: "locked", retryAt: user.pinLockedUntil, retryInMinutes };
  }

  const correct = verifyPin(pin, user.pinHash);

  if (correct) {
    if (user.pinFailedAttempts !== 0 || user.pinLockedUntil !== null) {
      await prisma.degenHunterUser.update({
        where: { chatId },
        data: { pinFailedAttempts: 0, pinLockedUntil: null },
      });
    }
    return { ok: true };
  }

  const failedAttempts = user.pinFailedAttempts + 1;
  const justLocked = failedAttempts >= PIN_MAX_ATTEMPTS;
  const lockedUntil = justLocked ? new Date(now.getTime() + PIN_LOCKOUT_MS) : null;

  await prisma.degenHunterUser.update({
    where: { chatId },
    // Reset the counter itself once locked, so the next window after
    // expiry starts fresh rather than immediately re-locking on attempt 1.
    data: { pinFailedAttempts: justLocked ? 0 : failedAttempts, pinLockedUntil: lockedUntil },
  });

  if (justLocked) {
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

  return { ok: false, reason: "incorrect", attemptsRemaining: justLocked ? 0 : PIN_MAX_ATTEMPTS - failedAttempts, justLocked };
}
