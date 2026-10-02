/**
 * Phase 0 auth: this is a single-user personal dashboard, so instead of a
 * full auth system we gate every page behind one shared password (env
 * DASHBOARD_PASSWORD) and a signed session cookie. Uses Web Crypto (not
 * node:crypto) so it works in both the edge middleware runtime and the
 * regular Node route handlers.
 */
export const SESSION_COOKIE = "max_session";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The value a valid session cookie must hold, derived from the password + a server-only secret so it can't be guessed or replayed from just the password. */
export async function expectedSessionToken(): Promise<string> {
  const password = process.env.DASHBOARD_PASSWORD ?? "";
  const secret = process.env.SESSION_SECRET ?? "";
  return sha256Hex(`${password}:${secret}`);
}

/**
 * Compares the submitted password to DASHBOARD_PASSWORD without leaking how many
 * leading characters matched: both are hashed to fixed-length digests first, then
 * compared in constant time (a plain `===` returns at the first differing byte).
 * Brute-force attempts are limited separately — see lib/login-lockout.ts.
 */
export async function checkPassword(candidate: string): Promise<boolean> {
  const password = process.env.DASHBOARD_PASSWORD ?? "";
  if (candidate.length === 0 || password.length === 0) return false;
  const [a, b] = await Promise.all([sha256Hex(candidate), sha256Hex(password)]);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
