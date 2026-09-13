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

export async function checkPassword(candidate: string): Promise<boolean> {
  const password = process.env.DASHBOARD_PASSWORD ?? "";
  return candidate.length > 0 && candidate === password;
}
