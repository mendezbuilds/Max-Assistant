import { Bot } from "grammy";
import { prisma } from "@max/db";
import { log } from "./logger";

/**
 * The shared Telegram notification pipe (SPEC.md Phase 0, item 2). Every
 * future agent sends alerts through `notify()` instead of talking to
 * Telegram directly — one bot, one place that knows who should hear from it.
 */
let bot: Bot | undefined;

export function createBot(token: string): Bot {
  bot = new Bot(token);

  bot.command("start", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const label = ctx.chat.username ?? ctx.chat.first_name ?? chatId;

    await prisma.notificationTarget.upsert({
      where: { chatId },
      update: { label },
      create: { chatId, label },
    });

    await log("system", "info", `Registered new Telegram notification target: ${label}`);
    await ctx.reply(
      "Max is online. You'll get alerts here as agents come online.\n\nSend /status for a quick roster check."
    );
  });

  bot.command("status", async (ctx) => {
    const agents = await prisma.agent.findMany({ orderBy: { phase: "asc" } });
    const lines = agents.map(
      (a) => `${a.enabled ? "🟢" : "⚪"} ${a.icon} ${a.name} — ${a.status}`
    );
    await ctx.reply(["*Max — agent roster*", ...lines].join("\n"), {
      parse_mode: "Markdown",
    });
  });

  bot.catch((err) => {
    console.error("[telegram] unhandled error", err);
  });

  return bot;
}

/** Send a message to every registered Telegram chat (usually just Mendez's). This is the "private feed" for agents like job-scout. */
export async function notify(message: string) {
  if (!bot) {
    console.warn("[telegram] notify() called before the bot was started; skipping:", message);
    return;
  }

  const targets = await prisma.notificationTarget.findMany();
  if (targets.length === 0) {
    console.warn("[telegram] no notification targets registered yet (send /start to the bot)");
    return;
  }

  await Promise.all(
    targets.map((t) =>
      bot!.api.sendMessage(t.chatId, message, { parse_mode: "Markdown" }).catch((err) => {
        console.error(`[telegram] failed to notify chat ${t.chatId}`, err);
      })
    )
  );
}

/**
 * Send a message to the public growth channel (e.g. job-scout's public feed).
 * Distinct from notify(): this is one specific channel, not every registered
 * private chat, and the bot must already be an admin of that channel able to
 * post messages. Set TELEGRAM_PUBLIC_CHANNEL_ID in .env to enable it (a
 * channel's id, e.g. from forwarding a message from it to @userinfobot).
 */
export async function notifyPublic(message: string) {
  if (!bot) {
    console.warn("[telegram] notifyPublic() called before the bot was started; skipping:", message);
    return;
  }

  const channelId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
  if (!channelId) {
    console.warn(
      "[telegram] TELEGRAM_PUBLIC_CHANNEL_ID not set — public feed message dropped. " +
        "Set it in .env once the bot is an admin of your growth channel."
    );
    return;
  }

  await bot.api.sendMessage(channelId, message, { parse_mode: "Markdown" }).catch((err) => {
    console.error(`[telegram] failed to post to public channel ${channelId}`, err);
  });
}

export function startBot(bot: Bot) {
  // bot.start() long-polls forever; run it without awaiting so it doesn't
  // block the scheduler from also starting.
  bot.start().catch((err) => {
    console.error("[telegram] bot crashed", err);
  });
}
