import path from "node:path";
import dotenv from "dotenv";

// Load the repo-root .env — this is a monorepo and apps/core's own cwd has
// no .env of its own; every secret (Telegram token, Claude key, ...) lives
// in one place at the repo root.
dotenv.config({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

// Point @max/db at the shared sqlite file (see the comment on DB_PATH in
// packages/db/src/client.ts for why this can't just be computed there).
// Must happen before anything that imports @max/db (below) actually does.
process.env.MAX_DB_FILE ??= path.resolve(__dirname, "..", "..", "..", "data", "max.db");

import { optionalEnv } from "@max/shared";
import { createBot, notify, startBot } from "./telegram";
import { startScheduler } from "./scheduler";
import { log } from "./logger";

async function main() {
  console.log("Starting Max core...");

  const telegramToken = optionalEnv("TELEGRAM_BOT_TOKEN");
  if (telegramToken) {
    const bot = createBot(telegramToken);
    startBot(bot);
    console.log("[telegram] bot started");
  } else {
    console.warn(
      "[telegram] TELEGRAM_BOT_TOKEN not set — notification pipe is disabled. " +
        "Get a token from @BotFather and set it in .env to enable it."
    );
  }

  startScheduler();

  await log("system", "info", "Max core started");
  if (telegramToken) {
    await notify("🟢 *Max core is online.*");
  }
}

main().catch((err) => {
  console.error("Fatal error starting Max core:", err);
  process.exit(1);
});
