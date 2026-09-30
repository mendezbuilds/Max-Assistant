import { cookies } from "next/headers";
import { SESSION_COOKIE, expectedSessionToken } from "./auth";
import fs from "fs";
import path from "path";

/**
 * Resolves the Degen Hunter owner chatId for web dashboard API routes.
 *
 * Architecture: The dashboard is a single-user personal tool (Phase 0 auth).
 * The session cookie only proves "you know the password" — it does not encode
 * a chatId. To link the web dashboard to the Telegram bot's data, the owner
 * must set DEGEN_OWNER_CHAT_ID in .env to their Telegram chatId.
 *
 * Returns the chatId string if the session is valid AND the owner chatId is
 * configured, or null otherwise. Never falls back to a global/other user's data.
 *
 * Note: cookies() is async in Next.js 15+; we handle both sync and async patterns.
 */
export async function resolveDegenOwnerChatId(): Promise<string | null> {
  // 1. Verify the dashboard session is authenticated
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE);
    if (!sessionCookie?.value) return null;

    const expected = await expectedSessionToken();
    if (sessionCookie.value !== expected) return null;
  } catch {
    // If cookie reading fails for any reason, treat as unauthenticated
    return null;
  }

  // 2. Resolve owner chatId from environment
  let chatId = process.env.DEGEN_OWNER_CHAT_ID?.trim();

  // In development, Next.js doesn't hot-reload custom .env paths (like our monorepo root .env).
  // Dynamically check the .env file if it's missing from process.env
  if (!chatId) {
    try {
      const repoRoot = process.env.MAX_REPO_ROOT || path.resolve(process.cwd(), "../../");
      const envPath = path.join(repoRoot, ".env");
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf8");
        const match = envContent.match(/^DEGEN_OWNER_CHAT_ID=(.+)$/m);
        if (match && match[1]) {
          chatId = match[1].trim();
          // Cache it for subsequent calls in this process
          process.env.DEGEN_OWNER_CHAT_ID = chatId;
        }
      }
    } catch {
      // Ignore fs errors
    }
  }

  if (!chatId) return null;

  return chatId;
}
