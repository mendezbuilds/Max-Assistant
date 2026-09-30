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
export async function notify(message: string, options?: any) {
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
      bot!.api.sendMessage(t.chatId, message, { parse_mode: "Markdown", ...options }).catch((err) => {
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

// A dev-mode file watcher (tsx watch) restarts core on every source edit —
// each restart's boot sequence would otherwise re-send this notification
// for real, every time, to a live chat. Caught in production (2026-09):
// 13 "online" messages in ~3 minutes during one active editing session.
// Not a crash loop or a scheduler bug — the 15-minute heartbeat never sends
// to Telegram at all (see scheduler.ts), only logs to the activity feed;
// this was purely the boot notification firing on every restart trigger.
//
// Gated against the ActivityLog history rather than in-memory state,
// deliberately — in-memory state resets on exactly the restarts this needs
// to detect, which would defeat the point. No new table needed: "Max core
// started" is already logged unconditionally on every boot (cheap, DB-only,
// no reason to skip it) — this just checks how recently that happened
// *before* this boot, and suppresses the real Telegram send if it was too
// recent to plausibly be a genuine redeploy rather than a dev-mode restart.
const BOOT_NOTIFY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export async function notifyOnBoot(message: string) {
  const recentBoots = await prisma.activityLog.findMany({
    where: { agentKey: "system", message: "Max core started" },
    orderBy: { createdAt: "desc" },
    take: 2,
  });

  // recentBoots[0] is this boot's own "Max core started" line (logged just
  // before this is called) — [1], if present, is the previous one.
  const previousBoot = recentBoots[1];
  if (previousBoot) {
    const msSincePrevious = Date.now() - previousBoot.createdAt.getTime();
    if (msSincePrevious < BOOT_NOTIFY_COOLDOWN_MS) {
      console.log(
        `[telegram] suppressing boot notification — core restarted ${Math.round(msSincePrevious / 1000)}s ` +
          "after the last one (looks like a dev-mode file-watcher restart, not a real redeploy)"
      );
      return;
    }
  }

  await notify(message);
}

export function startBot(bot: Bot) {
  // bot.start() long-polls forever; run it without awaiting so it doesn't
  // block the scheduler from also starting.
  bot.start().catch((err) => {
    console.error("[telegram] bot crashed", err);
  });
}
