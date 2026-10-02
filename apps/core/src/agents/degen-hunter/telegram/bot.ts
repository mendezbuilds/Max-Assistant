// Degen Hunter v1 - Phase 5: Telegram Control Room
// Dedicated Telegram bot for Degen Hunter (isolated from Max's main bot)

import fs from "node:fs";
import path from "node:path";
import { Bot, InlineKeyboard, InputFile } from "grammy";
import { recordSell, getClosedTradeStats, buildTradeCardPng, tradeCaption } from "../lib/positionPnl";
import { prisma } from "@max/db";
import { log } from "../../../logger";
import { runDegenHunter } from "../index";
import { DegenToken } from "../types";
import { generateTokenAlert } from "../index";
import { createHmac, timingSafeEqual, randomBytes, pbkdf2Sync, createHash } from "crypto";
import { createBurnerWallet, getSolBalance, exportPrivateKey, executeJupiterSwap, getTokenDecimals, checkTradable } from "../lib/solanaTrading";
import { hashPin, verifyPinWithLockout, assessRisk, formatPrice, getTokenHolding, sellAmountRaw, classifyTradeError, MIN_SOL_FOR_FEES, type PinCheckResult } from "@max/shared";
import { PublicKey } from "@solana/web3.js";
import { rpcEndpoint, getConnection } from "../lib/rpc";


// ─── Secure deletion of sensitive messages ─────────────────────────────────
// The exported private key is deleted after a short delay. A bare setTimeout
// isn't enough on its own: a core restart (tsx watch reloads on every save)
// kills the timer, and a failed delete used to be a console line nobody saw —
// either way the key stayed in the chat. So: the pending delete is persisted
// to disk and re-armed on startup, failures are retried, and as a last resort
// the message is edited to redact the key and the owner is told.
const PENDING_DELETES_FILE = path.join(
  path.dirname(process.env.MAX_DB_FILE ?? path.resolve(process.cwd(), "data", "max.db")),
  "pending-deletes.json"
);
/** How long the exported key stays visible before auto-delete. */
const KEY_MESSAGE_TTL_SECONDS = Math.max(3, Number(process.env.DEGEN_KEY_MESSAGE_TTL_SECONDS) || 5);

interface PendingDelete { chatId: string; messageId: number; deleteAt: number }

function readPendingDeletes(): PendingDelete[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(PENDING_DELETES_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingDeletes(list: PendingDelete[]) {
  try {
    fs.writeFileSync(PENDING_DELETES_FILE, JSON.stringify(list));
  } catch (err) {
    console.error("[degen-hunter] could not persist pending deletes:", err);
  }
}

function removePendingDelete(chatId: string, messageId: number) {
  writePendingDeletes(readPendingDeletes().filter((p) => !(p.chatId === chatId && p.messageId === messageId)));
}

async function deleteSensitiveMessage(api: any, chatId: string, messageId: number): Promise<boolean> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await api.deleteMessage(chatId, messageId);
      return true;
    } catch (err: any) {
      // Already gone (e.g. the owner deleted it themselves) — nothing left to protect.
      if (/message to delete not found/i.test(String(err?.description ?? err?.message))) return true;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  // Could not delete. Redact the content instead, and tell the owner.
  try {
    await api.editMessageText(chatId, messageId, "🔒 Key hidden. (Auto-delete failed — please delete this message manually.)");
  } catch { /* nothing more we can do automatically */ }
  await api
    .sendMessage(chatId, "⚠️ I couldn't auto-delete the exported key message. Please delete it manually right now.")
    .catch(() => {});
  log("degen-hunter-telegram", "error", "Failed to auto-delete the exported private key message — redacted it and asked the owner to delete it");
  return false;
}

function armSecureDelete(api: any, entry: PendingDelete) {
  const wait = Math.max(0, entry.deleteAt - Date.now());
  setTimeout(async () => {
    const ok = await deleteSensitiveMessage(api, entry.chatId, entry.messageId);
    if (ok) removePendingDelete(entry.chatId, entry.messageId);
  }, wait);
}

function scheduleSecureDelete(api: any, chatId: string, messageId: number, ms: number) {
  const entry: PendingDelete = { chatId, messageId, deleteAt: Date.now() + ms };
  writePendingDeletes([...readPendingDeletes(), entry]);
  armSecureDelete(api, entry);
}

/** On startup: delete anything that came due while core was down, re-arm the rest. */
function resumePendingDeletes(api: any) {
  for (const entry of readPendingDeletes()) armSecureDelete(api, entry);
}

// Messages in which the owner types a PIN. Deleted as soon as they arrive so
// the PIN doesn't sit in the chat history (or on a screen) afterwards.
const PIN_REPLY_STATES = new Set([
  "buy_confirm", "sell_confirm", "deposit", "withdraw",
  "set_pin", "change_pin_old", "change_pin_new", "export_key",
]);

/**
 * Deletes the owner's PIN messages right away: free-text replies while the
 * bot is waiting for a PIN, and "/pin 1234"-style commands. Fire-and-forget —
 * the handler still reads the text from the update it already holds. Private
 * chats only (a bot can delete incoming messages there).
 */
function scrubPinMessages() {
  return async (ctx: any, next: () => Promise<void>) => {
    const text: string | undefined = ctx.message?.text;
    if (text && ctx.chat?.type === "private") {
      const awaiting = userStates.get(String(ctx.chat.id))?.awaitingPinFor;
      const isPinReply = !text.startsWith("/") && !!awaiting && PIN_REPLY_STATES.has(awaiting.split(":")[0]);
      const isPinCommand = /^\/(pin|change_pin)(@\w+)?\s+\S+/i.test(text);
      if (isPinReply || isPinCommand) {
        ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
      }
    }
    await next();
  };
}

const shortIdMap = new Map<string, string>();

export function getShortId(tokenId: string): string {
  if (!tokenId) return "";
  const short = createHash('sha256').update(tokenId).digest('hex').substring(0, 12);
  shortIdMap.set(short, tokenId);
  return short;
}

export function resolveShortId(shortId: string): string {
  return shortIdMap.get(shortId) || shortId;
}

export function buildCallbackData(action: string, tokenId: string, param?: string): string {
  const shortId = getShortId(tokenId);
  const data = param ? `${action}:${shortId}:${param}` : `${action}:${shortId}`;
  
  if (Buffer.byteLength(data, 'utf8') > 64) {
    throw new Error(`Callback data exceeds 64 bytes: ${data}`);
  }
  return data;
}

// Helper type for Prisma extension (will be proper when models are added via migration)
interface PrismaExtension {
  degenHunterUser: {
    findUnique: (args: { where: { chatId: string } }) => Promise<any | null>;
    findMany: (args?: any) => Promise<any[]>;
    upsert: (args: {
      where: { chatId: string };
      update: any;
      create: any
    }) => Promise<any>;
  };
  degenHunterWallet: {
    findUnique: (args: { where: { chatId: string } }) => Promise<any | null>;
    upsert: (args: {
      where: { chatId: string };
      update: any;
      create: any
    }) => Promise<any>;
  };
  degenHunterWatchlist: {
    findMany: (args: {
      where: { chatId: string };
      include?: { token?: any };
      orderBy?: any;
      take?: number
    }) => Promise<any[]>;
    upsert: (args: {
      where: { chatId_tokenAddress: { chatId: string; tokenAddress: string } };
      update: {
        addedAt?: Date;
        tokenName?: string;
        tokenSymbol?: string;
        tokenChain?: string;
        pairAddress?: string | null;
        discoverySource?: string | null;
      };
      create: {
        chatId: string;
        tokenAddress: string;
        tokenName?: string;
        tokenSymbol?: string;
        tokenChain?: string;
        pairAddress?: string | null;
        discoverySource?: string | null;
        addedAt: Date;
      }
    }) => Promise<any>;
    count: (args: { where: { chatId: string } }) => Promise<number>;
    delete: (args: { where: { chatId_tokenAddress: { chatId: string; tokenAddress: string } } }) => Promise<any>;
  };
  degenHunterMutedToken: {
    upsert: (args: {
      where: { chatId_tokenAddress: { chatId: string; tokenAddress: string } };
      update: any;
      create: any
    }) => Promise<any>;
    count: (args: { where: { chatId: string } }) => Promise<number>;
    delete: (args: { where: { chatId_tokenAddress: { chatId: string; tokenAddress: string } } }) => Promise<any>;
  };
  degenHunterIgnoredToken: {
    upsert: (args: {
      where: { chatId_tokenAddress: { chatId: string; tokenAddress: string } };
      update: any;
      create: any
    }) => Promise<any>;
  };
  degenHunterPosition: {
    create: (args: { data: any }) => Promise<any>;
    findMany: (args: { where: any; orderBy?: any; take?: number }) => Promise<any[]>;
    findFirst: (args: { where: any }) => Promise<any>;
    update: (args: { where: any; data: any }) => Promise<any>;
  };
  // Add token storage for recent tokens
  degenHunterRecentToken: {
    upsert: (args: {
      where: { tokenId: string };
      update: any;
      create: any
    }) => Promise<any>;
    findUnique: (args: { where: { tokenId: string } }) => Promise<any | null>;
    findMany: (args: {
      where?: any;
      orderBy?: any;
      take?: number
    }) => Promise<any[]>;
    count: () => Promise<number>;
  };
}

// Extend Prisma client with Degen Hunter models (returns null if not implemented yet)
const extendedPrisma = prisma as unknown as PrismaExtension;

// Safe wrapper for Prisma operations that might not exist yet
const safePrisma = {
  degenHunterUser: {
    findUnique: async (args: { where: { chatId: string } }) => {
      try {
        return await extendedPrisma.degenHunterUser.findUnique(args);
      } catch (error) {
        // Model doesn't exist yet, return null
        return null;
      }
    },
    findMany: async (args?: any) => {
      try {
        return await extendedPrisma.degenHunterUser.findMany(args);
      } catch (error) {
        return [];
      }
    },
    upsert: async (args: {
      where: { chatId: string };
      update: any;
      create: any
    }) => {
      try {
        return await extendedPrisma.degenHunterUser.upsert(args);
      } catch (error) {
        // Model doesn't exist yet, simulate with in-memory
        console.warn("[degen-hunter-telegram] degenHunterUser model not available, using in-memory storage");
        return null;
      }
    }
  },
  degenHunterWallet: {
    findUnique: async (args: { where: { chatId: string } }) => {
      try {
        return await extendedPrisma.degenHunterWallet.findUnique(args);
      } catch (error) {
        return null;
      }
    },
    upsert: async (args: {
      where: { chatId: string };
      update: any;
      create: any
    }) => {
      try {
        return await extendedPrisma.degenHunterWallet.upsert(args);
      } catch (error) {
        console.warn("[degen-hunter-telegram] degenHunterWallet model not available, using in-memory storage");
        return null;
      }
    }
  },
  degenHunterWatchlist: {
    findMany: async (args: {
      where: { chatId: string };
      include?: { token?: any };
      orderBy?: any;
      take?: number
    }) => {
      try {
        return await extendedPrisma.degenHunterWatchlist.findMany(args);
      } catch (error) {
        return [];
      }
    },
    upsert: async (args: {
      where: { chatId_tokenAddress: { chatId: string; tokenAddress: string } };
      update: any;
      create: any
    }) => {
      try {
        return await extendedPrisma.degenHunterWatchlist.upsert(args);
      } catch (error) {
        console.warn("[degen-hunter-telegram] degenHunterWatchlist model not available, using in-memory storage");
        return null;
      }
    },
    delete: async (args: {
      where: { chatId_tokenAddress: { chatId: string; tokenAddress: string } }
    }) => {
      try {
        return await extendedPrisma.degenHunterWatchlist.delete(args);
      } catch (error) {
        return null;
      }
    },
    count: async (args: { where: { chatId: string } }) => {
      try {
        return await extendedPrisma.degenHunterWatchlist.count(args);
      } catch (error) {
        return 0;
      }
    }
  },
  degenHunterMutedToken: {
    upsert: async (args: {
      where: { chatId_tokenAddress: { chatId: string; tokenAddress: string } };
      update: any;
      create: any
    }) => {
      try {
        return await extendedPrisma.degenHunterMutedToken.upsert(args);
      } catch (error) {
        console.warn("[degen-hunter-telegram] degenHunterMutedToken model not available, using in-memory storage");
        return null;
      }
    },
    count: async (args: { where: { chatId: string } }) => {
      try {
        return await extendedPrisma.degenHunterMutedToken.count(args);
      } catch (error) {
        return 0;
      }
    },
    delete: async (args: { where: { chatId_tokenAddress: { chatId: string; tokenAddress: string } } }) => {
      try {
        return await extendedPrisma.degenHunterMutedToken.delete(args);
      } catch (error) {
        return null;
      }
    }
  },
  degenHunterIgnoredToken: {
    upsert: async (args: {
      where: { chatId_tokenAddress: { chatId: string; tokenAddress: string } };
      update: any;
      create: any
    }) => {
      try {
        return await extendedPrisma.degenHunterIgnoredToken.upsert(args);
      } catch (error) {
        console.warn("[degen-hunter-telegram] degenHunterIgnoredToken model not available, using in-memory storage");
        return null;
      }
    }
  },
  degenHunterPosition: {
    create: async (args: { data: any }) => {
      try {
        return await extendedPrisma.degenHunterPosition.create(args);
      } catch (error) {
        console.warn("[degen-hunter-telegram] degenHunterPosition model not available, using in-memory storage");
        return null;
      }
    },
    findMany: async (args: { where: any; orderBy?: any; take?: number }) => {
      try {
        return await extendedPrisma.degenHunterPosition.findMany(args);
      } catch (error) {
        return [];
      }
    },
    findFirst: async (args: { where: any }) => {
      try {
        return await extendedPrisma.degenHunterPosition.findFirst(args);
      } catch (error) {
        return null;
      }
    },
    update: async (args: { where: any; data: any }) => {
      try {
        return await extendedPrisma.degenHunterPosition.update(args);
      } catch (error) {
        return null;
      }
    }
  },
  // Token storage for recent tokens
  degenHunterRecentToken: {
    upsert: async (args: {
      where: { tokenId: string };
      update: any;
      create: any
    }) => {
      try {
        return await extendedPrisma.degenHunterRecentToken.upsert(args);
      } catch (error) {
        console.warn("[degen-hunter-telegram] degenHunterRecentToken model not available, using in-memory storage");
        return null;
      }
    },
    findUnique: async (args: { where: { tokenId: string } }) => {
      try {
        return await extendedPrisma.degenHunterRecentToken.findUnique(args);
      } catch (error) {
        return null;
      }
    },
    findMany: async (args: {
      where?: any;
      orderBy?: any;
      take?: number
    }) => {
      try {
        return await extendedPrisma.degenHunterRecentToken.findMany(args);
      } catch (error) {
        return [];
      }
    },
    count: async () => {
      try {
        return await extendedPrisma.degenHunterRecentToken.count();
      } catch (error) {
        return 0;
      }
    }
  }
};

// Environment variables loaded at runtime
// Bot instance
let bot: Bot | null = null;
let botStarted = false;

// In-memory stores for performance (backed by database)
const userStates = new Map<string, any>();
const alertCooldowns = new Map<string, number>(); // tokenId -> timestamp
const mutedTokens = new Set<string>(); // tokenIds that are muted
const recentTokens = new Map<string, DegenToken>(); // tokenId -> token data

// Configuration
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes between alerts for same token
const MAX_ALERTS_PER_HOUR = 5; // Rate limiting
const MAX_RECENT_TOKENS = 100; // Keep last 100 tokens in memory

// PIN security configuration


// Cooldown map for private key export (chatId -> timestamp)
const exportCooldowns = new Map<string, number>();

/**
 * Token ids look like "solana:<pair>:<address>" — they contain colons — so state
 * strings such as "custom_buy:<tokenId>" or "buy_confirm:<tokenId>:<amount>" can't
 * be split on ":" and indexed. (Doing that picked the pair address as the token id,
 * so custom amounts and PIN-confirmed trades looked up the wrong token.)
 */
function stateTail(state: string): string {
  return state.slice(state.indexOf(":") + 1);
}

function parseConfirmState(state: string): { action: string; tokenId: string; value: string } {
  const first = state.indexOf(":");
  const last = state.lastIndexOf(":");
  return { action: state.slice(0, first), tokenId: state.slice(first + 1, last), value: state.slice(last + 1) };
}

/**
 * Trade handlers are written for button presses: they edit "the message the
 * button was on". When the flow continues from a typed message (a custom amount,
 * a PIN) the only message is the owner's own text, which a bot can't edit — and
 * which may already have been deleted. This wraps the context so those edits are
 * sent as new messages instead.
 */
function asReplyCtx(ctx: any) {
  return {
    ...ctx,
    editMessageText: async (msg: string, extra: any) => ctx.reply(msg, extra),
    api: Object.assign(Object.create(ctx.api), {
      editMessageText: (cid: any, _mid: any, text: string, extra: any) => ctx.api.sendMessage(cid, text, extra),
    }),
    callbackQuery: { message: { message_id: ctx.message?.message_id } },
  };
}

// Initialize the bot
async function handleTextMessage(ctx: any) {
  const chatId = String(ctx.chat.id);
  const text = ctx.message?.text?.trim() || "";

  // Ignore messages that start with "/" — those are commands handled separately
  if (text.startsWith("/")) return;

  const userState = userStates.get(chatId);
  if (!userState) return; // No active state — ignore free text

  const { awaitingPinFor } = userState;

  // Route based on awaiting state
  
  // Custom Buy Amount
  if (awaitingPinFor?.startsWith("custom_buy:")) {
    const tokenId = stateTail(awaitingPinFor);
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply("❌ Invalid amount. Please enter a valid number (e.g. 0.5):", { parse_mode: "Markdown" });
      return;
    }
    userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
    await handleBuyAmount(asReplyCtx(ctx), tokenId, chatId, text);
    return;
  }

  // Custom Sell Amount
  if (awaitingPinFor?.startsWith("custom_sell:")) {
    const tokenId = stateTail(awaitingPinFor);
    const percent = parseFloat(text);
    if (isNaN(percent) || percent <= 0 || percent > 100) {
      await ctx.reply("❌ Invalid percentage. Please enter a number between 1 and 100:", { parse_mode: "Markdown" });
      return;
    }
    userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
    await handleSellAmount(asReplyCtx(ctx), tokenId, chatId, text);
    return;
  }

  // Trade Confirmation via PIN
  if (awaitingPinFor?.startsWith("buy_confirm:") || awaitingPinFor?.startsWith("sell_confirm:")) {
    const { action, tokenId, value: amountOrPercent } = parseConfirmState(awaitingPinFor);

    const pin = text;
    const pinCheck = await verifyPinWithLockout(chatId, pin);
    if (!pinCheck.ok) {
      await replyPinRejection(ctx, pinCheck, "❌ *Incorrect PIN.* Trade cancelled.");
      userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
      return;
    }
    
    userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
    
    // The confirm functions expect to edit a button's message; here there's only the (deleted) PIN message.
    const mockCtx = asReplyCtx(ctx);

    if (action === "buy_confirm") {
      await handleBuyConfirm(mockCtx, tokenId, chatId, amountOrPercent);
    } else {
      await handleSellConfirm(mockCtx, tokenId, chatId, amountOrPercent);
    }
    return;
  }
  if (awaitingPinFor === "deposit") {
    // Expecting PIN for deposit; synthesize a /deposit PIN call
    const amount = userState.pendingDepositAmount;
    if (!amount) {
      userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
      return;
    }
    const pin = text;
    const pinCheck = await verifyPinWithLockout(chatId, pin);
    if (!pinCheck.ok) {
      await replyPinRejection(ctx, pinCheck, "❌ *Incorrect PIN.* Please try again:");
      if (pinCheck.reason === "locked" || (pinCheck.reason === "incorrect" && pinCheck.justLocked)) userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
      return;
    }
    // Correct — execute deposit
    userStates.set(chatId, { ...userState, awaitingPinFor: undefined, pendingDepositAmount: undefined });
    const newBalance = (userState.paperWalletBalance || 0) + amount;
    userState.paperWalletBalance = newBalance;
    await safePrisma.degenHunterWallet.upsert({
      where: { chatId },
      update: { balance: newBalance, updatedAt: new Date() },
      create: { chatId, balance: newBalance, createdAt: new Date(), updatedAt: new Date() }
    });
    await ctx.reply(
      `*💰 Deposit Successful*\n\nDeposited: ${amount.toFixed(4)} SOL\nNew Balance: ${newBalance.toFixed(4)} SOL ($${(newBalance * 150).toFixed(2)})\n\n*Note:* Paper trading only.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (awaitingPinFor === "withdraw") {
    const amount = userState.pendingWithdrawAmount;
    if (!amount) {
      userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
      return;
    }
    const pin = text;
    const pinCheck = await verifyPinWithLockout(chatId, pin);
    if (!pinCheck.ok) {
      await replyPinRejection(ctx, pinCheck, "❌ *Incorrect PIN.* Please try again:");
      if (pinCheck.reason === "locked" || (pinCheck.reason === "incorrect" && pinCheck.justLocked)) userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
      return;
    }
    userStates.set(chatId, { ...userState, awaitingPinFor: undefined, pendingWithdrawAmount: undefined });
    const balance = userState.paperWalletBalance || 0;
    if (amount > balance) {
      await ctx.reply("❌ Insufficient balance.", { parse_mode: "Markdown" });
      return;
    }
    const newBalance = balance - amount;
    userState.paperWalletBalance = newBalance;
    await safePrisma.degenHunterWallet.upsert({
      where: { chatId },
      update: { balance: newBalance, updatedAt: new Date() },
      create: { chatId, balance: newBalance, createdAt: new Date(), updatedAt: new Date() }
    });
    await ctx.reply(
      `*💸 Withdrawal Successful*\n\nWithdrew: ${amount.toFixed(4)} SOL\nNew Balance: ${newBalance.toFixed(4)} SOL ($${(newBalance * 150).toFixed(2)})\n\n*Note:* Paper trading only.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (awaitingPinFor === "set_pin" || awaitingPinFor === "change_pin_new") {
    // Expecting a new PIN to set
    if (!/^\d{4,8}$/.test(text)) {
      await ctx.reply("❌ PIN must be 4-8 digits. Please try again:", { parse_mode: "Markdown" });
      return;
    }
    const hashedPin = hashPin(text);
    await safePrisma.degenHunterUser.upsert({
      where: { chatId },
      update: { pinHash: hashedPin },
      create: { chatId, pinHash: hashedPin }
    });
    userStates.set(chatId, { ...userState, awaitingPinFor: undefined, pinSet: true });
    await ctx.reply("✅ *PIN set successfully!*\n\nYour wallet is now PIN-protected.", { parse_mode: "Markdown" });
    return;
  }

  if (awaitingPinFor === "change_pin_old") {
    // Verifying old PIN before allowing change
    const pinCheck = await verifyPinWithLockout(chatId, text);
    if (!pinCheck.ok) {
      await replyPinRejection(ctx, pinCheck, "❌ *Incorrect PIN.* Please try again:");
      if (pinCheck.reason === "locked" || (pinCheck.reason === "incorrect" && pinCheck.justLocked)) userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
      return;
    }
    userStates.set(chatId, { ...userState, awaitingPinFor: "change_pin_new" });
    await ctx.reply("✅ PIN verified. Enter your *new PIN* (4-8 digits):", { parse_mode: "Markdown" });
    return;
  }

  if (awaitingPinFor === "export_key") {
    // Verify PIN
    if (!text || !/^\d{4,8}$/.test(text)) {
      await ctx.reply("❌ *Invalid PIN.* PIN must be 4–8 digits. Please try again:", { parse_mode: "Markdown" });
      return;
    }
    const pinCheck = await verifyPinWithLockout(chatId, text);
    if (!pinCheck.ok) {
      await replyPinRejection(ctx, pinCheck, "❌ *Incorrect PIN.* Please try again:");
      if (pinCheck.reason === "locked" || (pinCheck.reason === "incorrect" && pinCheck.justLocked)) userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
      return;
    }

    // Check cooldown
    const lastExport = exportCooldowns.get(chatId) || 0;
    if (Date.now() - lastExport < 60000) {
      const secsLeft = Math.ceil((60000 - (Date.now() - lastExport)) / 1000);
      userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
      await ctx.reply(`⏳ *Cooldown Active*\n\nPlease wait ${secsLeft}s before exporting again.`, { parse_mode: "Markdown" });
      return;
    }

    // PIN verified — clear state and export real key
    userStates.set(chatId, { ...userState, awaitingPinFor: undefined });

    const privKey = await exportPrivateKey(chatId);
    if (!privKey) {
      await ctx.reply(
        `❌ *Export Failed*\n\nNo burner wallet found.\n\nCreate one first: Wallet → Generate Burner Wallet`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    exportCooldowns.set(chatId, Date.now());

    const sentMsg = await ctx.reply(
      `*🔑 Burner Wallet Private Key*\n\n` +
      `\`${privKey}\`\n\n` +
      `⚠️ *WARNING:* Never share this key. Anyone with this key controls your wallet.\n` +
      `_This message will self-destruct in ${KEY_MESSAGE_TTL_SECONDS} seconds._`,
      { parse_mode: "Markdown" }
    );

    // Persisted + retried delete (see scheduleSecureDelete)
    scheduleSecureDelete(ctx.api, chatId, sentMsg.message_id, KEY_MESSAGE_TTL_SECONDS * 1000);

    return;
  }
}

export function createDegenHunterBot(): Bot {
  if (!bot) {
    const token = process.env.DEGEN_TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error("DEGEN_TELEGRAM_BOT_TOKEN is required in .env");
    }
    bot = new Bot(token);
    setupBot();
  }
  return bot;
}

/**
 * Restricts every command/callback/message to the configured owner chat —
 * previously there was no such gate at all: `handleStart` registered ANY
 * Telegram user who messaged the bot and let them generate their own real
 * burner wallet and trade with it. This is a single-user personal tool
 * (see apps/dashboard/src/lib/degen-identity.ts's own doc comment on the
 * same DEGEN_OWNER_CHAT_ID var — the dashboard already enforces this, the
 * bot just never did). Fails closed: if DEGEN_OWNER_CHAT_ID isn't set,
 * nobody gets through rather than silently letting everyone in.
 */
function requireOwner() {
  return async (ctx: any, next: () => Promise<void>) => {
    const ownerChatId = process.env.DEGEN_OWNER_CHAT_ID?.trim();
    const chatId = ctx.chat?.id ?? ctx.from?.id;

    if (!ownerChatId) {
      console.error("[degen-hunter-telegram] DEGEN_OWNER_CHAT_ID is not set — refusing all access until configured.");
      return;
    }
    if (String(chatId) !== ownerChatId) {
      console.warn(`[degen-hunter-telegram] blocked access from unauthorized chat ${chatId}`);
      // Channels/groups (e.g. the DEGEN_ALERTS_CHAT_ID alerts channel, where
      // the bot is an admin and sees every post) are blocked silently — a
      // "private bot" reply there is just noise posted into the channel.
      if (ctx.chat && ctx.chat.type !== "private") return;
      if (ctx.chat) {
        await ctx.reply("This bot is private and not available for public use.").catch(() => {});
      } else if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: "This bot is private.", show_alert: true }).catch(() => {});
      }
      return;
    }
    await next();
  };
}

/**
 * Sends the appropriate rejection reply for a failed verifyPinWithLockout()
 * result — every one of this file's 9 PIN-entry points calls this instead
 * of composing its own message, so the lockout case (new behavior) reads
 * identically everywhere, while each site's own "incorrect PIN" wording is
 * still passed in and preserved.
 */
async function replyPinRejection(ctx: any, result: Exclude<PinCheckResult, { ok: true }>, incorrectMessage: string): Promise<void> {
  if (result.reason === "locked") {
    await ctx.reply(
      `🔒 *Too many incorrect PIN attempts.*\n\nTry again in ${result.retryInMinutes} minute(s).`,
      { parse_mode: "Markdown" }
    );
  } else if (result.reason === "incorrect" && result.justLocked) {
    // This IS the attempt that triggered the lockout — say so now, not
    // just on the next attempt after the fact.
    await ctx.reply(
      `🔒 *Too many incorrect PIN attempts.*\n\nYour account is now locked for 15 minutes.`,
      { parse_mode: "Markdown" }
    );
  } else {
    await ctx.reply(incorrectMessage, { parse_mode: "Markdown" });
  }
}

// Setup all bot handlers
function setupBot() {
  if (!bot) return;

  // Owner-only gate — must run before any command/callback/message handler below.
  bot.use(requireOwner());
  // Right after the owner gate: delete any PIN the owner types, as it arrives.
  bot.use(scrubPinMessages());

  // Commands
  bot.command("start", handleStart);
  bot.command("help", handleHelp);
  bot.command("status", (ctx) => handleStatus(ctx));
  bot.command("wallet", (ctx) => handleWallet(ctx));
  bot.command("watchlist", (ctx) => handleWatchlist(ctx));
  bot.command("settings", (ctx) => handleSettings(ctx));
  bot.command("mute", handleMute);
  bot.command("unmute", handleUnmute);
  bot.command("deposit", handleDeposit);
  bot.command("withdraw", handleWithdraw);
  bot.command("history", (ctx) => handleHistory(ctx));
  bot.command("export_key", handleExportKey);
  bot.command("pin", handlePin);
  bot.command("change_pin", handleChangePin);

  // Callback queries (inline buttons)
  bot.on("callback_query", handleCallbackQuery);

  // Text message handler — dispatches stale-state PIN/amount flows
  bot.on("message:text", handleTextMessage);

  // Error handling
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error("[degen-hunter-telegram] unhandled error", err);
    // Also to the activity feed: the user only ever sees "An error occurred", so
    // the real cause has to be findable somewhere other than a terminal.
    log("degen-hunter-telegram", "error", `Unhandled bot error: ${(err.error as Error)?.message ?? String(err.error)}`);
    if (ctx?.callbackQuery?.message) {
      ctx.answerCallbackQuery("An error occurred. Please try again.").catch(() => {});
    } else if (ctx?.message) {
      ctx.reply("An error occurred. Please try again.").catch(() => {});
    }
  });

  log("degen-hunter-telegram", "info", "Degen Hunter Telegram bot initialized");
}

// Start the bot (non-blocking)
export function startBot() {
  if (botStarted) {
    log("degen-hunter-telegram", "warn", "Prevented duplicate Telegram polling instance initialization");
    return;
  }
  if (!bot) {
    createDegenHunterBot();
  }
  if (bot) {
    botStarted = true;
    
    // Warm up the short ID map from recent tokens to ensure callbacks work across restarts
    safePrisma.degenHunterRecentToken.findMany({ take: 5000, orderBy: { createdAt: 'desc' } })
      .then((tokens: any[]) => {
        for (const t of tokens) {
          if (t.tokenId) getShortId(t.tokenId);
        }
        log("degen-hunter-telegram", "info", `Warmed up ${tokens.length} short IDs for callbacks`);
      })
      .catch((err: any) => console.error("Failed to warm up short IDs:", err));

    // Delete (or re-arm) any exported-key messages left over from before a restart.
    resumePendingDeletes(bot.api);

    bot.start().catch((err) => {
      botStarted = false;
      console.error("[degen-hunter-telegram] bot crashed", err);
      log("degen-hunter-telegram", "error", `Bot crashed: ${err.message}`);
    });
    log("degen-hunter-telegram", "info", "Degen Hunter Telegram bot started");

    // Configure native Telegram UI — deferred 2s so tsx hot-reload network
    // is settled before calling the Telegram API.
    setTimeout(() => {
      bot!.api.setMyCommands([
        { command: "start",     description: "🔥 Open Control Room" },
        { command: "wallet",    description: "💰 Burner Wallet" },
        { command: "watchlist", description: "👀 My Watchlist" },
        { command: "status",    description: "📊 Bot & Agent Status" },
        { command: "history",   description: "📜 Trade History" },
        { command: "settings",  description: "⚙️ Alert Settings" },
        { command: "help",      description: "❓ Help & Commands" },
      ]).then(() => {
        log("degen-hunter-telegram", "info", "Bot command list registered");
      }).catch((err) => {
        console.warn("[degen-hunter-telegram] setMyCommands failed (non-fatal):", err.message);
      });

      bot!.api.setChatMenuButton({
        menu_button: { type: "commands" },
      }).then(() => {
        log("degen-hunter-telegram", "info", "Bot menu button configured (type: commands)");
      }).catch((err) => {
        console.warn("[degen-hunter-telegram] setChatMenuButton failed (non-fatal):", err.message);
      });
    }, 2000);
  }
}

// Stop the bot
export async function stopBot() {
  if (bot) {
    await bot.stop();
    bot = null;
    log("degen-hunter-telegram", "info", "Degen Hunter Telegram bot stopped");
  }
}

// Store a token for later retrieval by button handlers
export function storeTokenForTelegram(token: DegenToken): void {
  recentTokens.set(token.id, token);

  // Keep only the most recent tokens to prevent memory growth
  if (recentTokens.size > MAX_RECENT_TOKENS) {
    // Remove oldest tokens (first ones in the map)
    const tokensToRemove = recentTokens.size - MAX_RECENT_TOKENS;
    let count = 0;
    for (const [tokenId] of recentTokens) {
      if (count >= tokensToRemove) break;
      recentTokens.delete(tokenId);
      count++;
    }
  }

  // Also store in database if available
  safePrisma.degenHunterRecentToken.upsert({
    where: { tokenId: token.id },
    update: {
      tokenData: JSON.stringify(token),
      updatedAt: new Date()
    },
    create: {
      tokenId: token.id,
      tokenData: JSON.stringify(token),
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }).catch(() => {
    // Ignore database errors for now
  });
}

// Command handlers
async function handleStart(ctx: any) {
  const chatId = String(ctx.chat.id);
  const username = ctx.chat.username || ctx.chat.first_name || "User";

  // Register user
  await safePrisma.degenHunterUser.upsert({
    where: { chatId },
    update: { username, lastActive: new Date() },
    create: { chatId, username, lastActive: new Date() },
  });

  // Initialize user state — clear any stale pending states on /start
  userStates.set(chatId, {
    paperWalletBalance: 0,
    settings: {
      alertsEnabled: true,
      minScoreThreshold: 50,
      riskLevelFilter: ["medium", "high"],
      notifyOnNewTokens: true,
    },
    pinSet: false,
    awaitingPinFor: undefined,
    pendingDepositAmount: undefined,
    pendingWithdrawAmount: undefined,
  });

  // ─── Deep-link dispatch from MAX alerts ───────────────────────────────────
  // Handles: /start buy_<tokenId>  and  /start watch_<tokenId>
  const startParam: string | undefined = ctx.message?.text?.split(" ")[1];
  if (startParam) {
    // From the alerts channel's "Open in bot" button: show that token's full
    // card (with Watch/Buy/etc.) here in the private chat. The payload carries
    // the 12-char short id (token ids contain ":" which link payloads forbid).
    if (startParam.startsWith("d_")) {
      const tokenId = resolveShortId(startParam.slice(2));
      const token = await getTokenById(tokenId);
      if (token) {
        await ctx.reply(generateEnhancedTokenAlert(token), {
          reply_markup: alertKeyboard(token),
          parse_mode: "Markdown",
          link_preview_options: { is_disabled: true },
        });
      } else {
        await ctx.reply("⚠️ *Token not found*\n\nThat token is no longer in the recent feed. Open the Control Room → Alerts to see current ones.", { parse_mode: "Markdown" });
      }
      return;
    }
    if (startParam.startsWith("buy_")) {
      const tokenId = startParam.slice(4);
      const token = await getTokenById(tokenId);
      if (token) {
        const balance = await getSolBalance(chatId).catch(() => 0);
        const keyboard = new InlineKeyboard()
          .text("0.1 SOL", buildCallbackData("buy_amount", tokenId, "0.1")).text("0.5 SOL", buildCallbackData("buy_amount", tokenId, "0.5")).row()
          .text("1 SOL", buildCallbackData("buy_amount", tokenId, "1")).text("2 SOL", buildCallbackData("buy_amount", tokenId, "2")).row()
          .text("Custom Amount", buildCallbackData("buy_custom", tokenId)).row()
          .text("◀️ Back", "menu_control_room");
        await ctx.reply(
          `💰 *Buy ${token.symbol}*\n\n` +
          `*Available Balance:* ${balance.toFixed(4)} SOL\n` +
          `*Current Price:* ${formatPrice(token.priceUsd ?? 0)}\n\n` +
          `Select amount to buy:`,
          { parse_mode: "Markdown", reply_markup: keyboard }
        );
        return;
      } else {
        await ctx.reply(
          `⚠️ *Token not found*\n\nThe token from the MAX alert is no longer cached. Use /watchlist to see recent alerts.`,
          { parse_mode: "Markdown" }
        );
        return;
      }
    } else if (startParam.startsWith("watch_")) {
      const tokenId = startParam.slice(6);
      const token = await getTokenById(tokenId);
      if (token) {
        await safePrisma.degenHunterWatchlist.upsert?.({
          where: { chatId_tokenAddress: { chatId, tokenAddress: token.contractAddress } },
          update: {},
          create: { chatId, tokenAddress: token.contractAddress, tokenSymbol: token.symbol, tokenName: token.name, addedAt: new Date() }
        });
        await setWatchBaseline(chatId, token.contractAddress, token.priceUsd);
        await ctx.reply(
          `👁 *Added to Watchlist*\n\n*${token.name}* ($${token.symbol}) has been added to your watchlist.`,
          { parse_mode: "Markdown" }
        );
        return;
      } else {
        await ctx.reply(
          `⚠️ *Token not found*\n\nThe token from the MAX alert is no longer cached.`,
          { parse_mode: "Markdown" }
        );
        return;
      }
    }
  }

  await sendControlRoom(ctx, false);
}

// Control Room UI
async function sendControlRoom(ctx: any, isEdit: boolean = false) {
  const username = ctx.from?.username || ctx.from?.first_name || "User";
  const keyboard = new InlineKeyboard()
    .text("🔥 Alerts", "menu_alerts").text("👀 Watchlist", "menu_watchlist").row()
    .text("💰 Wallet", "menu_wallet").text("⚙️ Settings", "menu_settings").row()
    .text("📊 Status", "menu_status").text("📜 History", "menu_history");
  
  const text = `🔥 *Degen Hunter Control Room* 🔥\n\n` +
    `Welcome, ${username}! You're now connected to the Degen Hunter app.\n\n` +
    `Select an option below or use /help to see fallback commands.`;
    
  if (isEdit && ctx.editMessageText) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
  } else {
    if (ctx.reply) {
      await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
    } else {
      await bot!.api.sendMessage(ctx.chat?.id || ctx.from?.id, text, { parse_mode: "Markdown", reply_markup: keyboard });
    }
  }
}

async function handleHelp(ctx: any) {
  await ctx.reply(
    `*Degen Hunter Telegram Bot Help*\n\n` +
    `/start - Initialize the bot\n` +
    `/help - Show this help message\n` +
    `/status - Show bot and agent status\n` +
    `/wallet - View your burner wallet\n` +
    `/watchlist - View your watched tokens\n` +
    `/settings - Configure alert preferences\n` +
    `/mute \`tokenAddress\` - Mute alerts for a token\n` +
    `/unmute \`tokenAddress\` - Unmute alerts for a token\n\n` +
    `*Wallet Commands (require PIN setup):*\n` +
    `/history - View trade history\n` +
    `\`/export_key\` - Export wallet private key (PIN required)\n\n` +
    `*Inline Buttons (on alerts):*\n` +
    `📊 Chart - View token chart\n` +
    `📋 Details - View full token information\n` +
    `👁️ Watch - Add token to watchlist\n` +
    `🚫 Ignore - Hide similar tokens\n` +
    `💰 Buy - Real buy via burner wallet + Jupiter\n` +
    `📉 Sell - Real sell via burner wallet + Jupiter\n` +
    `🔇 Mute - Mute alerts for this token\n\n` +
    `*Trading:*\n` +
    `All trades are real and execute on Solana via Jupiter. PIN is required to authorize every trade.`,
    { parse_mode: "Markdown" }
  );
}

async function handleStatus(ctx: any, isEdit: boolean = false) {
  // Get Degen Hunter agent status
  const agentStatus = await prisma.agent.findFirst({
    where: { name: "degen-hunter" },
  });

  // Get stats
  const chatId = String(ctx.chat.id);
  const watchlistCount = await safePrisma.degenHunterWatchlist.count?.({ where: { chatId } }) || 0;
  const mutedCount = await safePrisma.degenHunterMutedToken.count?.({ where: { chatId } }) || 0;
  
  const walletRecord = await safePrisma.degenHunterWallet.findUnique?.({ where: { chatId } });
  // Fetch real on-chain balance (falls back to 0 if no wallet or RPC failure)
  const solBalance = walletRecord?.publicKey ? await getSolBalance(chatId) : 0;

  let openPositionsCount = 0;
  try {
    const positions = await safePrisma.degenHunterPosition.findMany?.({ where: { chatId, status: "OPEN" } }) || [];
    openPositionsCount = positions.length;
  } catch (err) {}

  const tokensDiscovered = await prisma.seenItem.count().catch(() => 0);
  const alertsSent = await safePrisma.degenHunterRecentToken.count().catch(() => 0);

  const text = `*📊 Degen Hunter Status*\n\n` +
    `*Agent State*\n` +
    `Agent: ${agentStatus ? (agentStatus.enabled ? "🟢 Online" : "🔴 Disabled") : "⚪ Unknown"}\n` +
    `Phase: ${agentStatus?.phase || "N/A"}\n` +
    `Status: ${agentStatus?.status || "N/A"}\n\n` +
    `*System Stats*\n` +
    `Tokens Discovered: ${tokensDiscovered.toLocaleString()}\n` +
    `Alerts Processed: ${alertsSent.toLocaleString()}\n\n` +
    `*Your Stats*\n` +
    `Watchlist: ${watchlistCount} tokens\n` +
    `Muted: ${mutedCount} tokens\n` +
    `Burner Wallet: ${walletRecord?.publicKey ? `${solBalance.toFixed(4)} SOL (real)` : "Not created"}\n` +
    `Open Positions: ${openPositionsCount}\n\n` +
    `Last updated: ${new Date().toLocaleTimeString()}`;
    
  const keyboard = new InlineKeyboard().text("◀️ Back to Control Room", "menu_control_room");

  if (isEdit) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  }
}

async function handleWallet(ctx: any, isEdit: boolean = false) {
  const chatId = String(ctx.chat.id);
  let userState = userStates.get(chatId);

  if (!userState) {
    await handleStart(ctx);
    userState = userStates.get(chatId)!;
  }

  // Check if the user's burner wallet has been explicitly created yet
  const walletRecord = await safePrisma.degenHunterWallet.findUnique?.({ where: { chatId } }) || null;

  if (!walletRecord || !walletRecord.publicKey) {
    // ── No wallet yet: show the onboarding / Create Wallet screen ──
    const text = `💰 *Degen Hunter Burner Wallet*\n\n` +
      `You don't have a burner wallet yet.\n\n` +
      `*What is this wallet?*\n` +
      `Degen Hunter uses a *real Solana burner wallet* — a dedicated wallet used exclusively for executing real trades on your behalf. ` +
      `Its private key is stored encrypted at rest on our secure backend.\n\n` +
      `This wallet is dedicated to Degen Hunter and kept completely separate from your main Solana wallet.`;

    const keyboard = new InlineKeyboard()
      .text("🔐 Generate Burner Wallet", "action_create_wallet").row()
      .text("◀️ Back to Control Room", "menu_control_room");

    if (isEdit) {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
    }
    return;
  }

  // ── Wallet exists: show the dashboard ──
  const solBalance = await getSolBalance(chatId);

  const text = `💰 *Degen Hunter Burner Wallet*\n\n` +
    `Address: \`${walletRecord.publicKey}\`\n` +
    `Balance: ${solBalance.toFixed(4)} SOL\n\n` +
    `*Note:* This is a real Solana wallet. Protect your PIN.`;

  const keyboard = new InlineKeyboard()
    .text("📊 Positions", "action_positions").text("📜 History", "action_history").row()
    .text("🔐 Export Private Key", "action_export_key").row()
    .text("◀️ Back to Control Room", "menu_control_room");

  if (isEdit) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  }
}

async function handleWatchlist(ctx: any, isEdit: boolean = false) {
  const chatId = String(ctx.chat.id);
  const watchlist = await safePrisma.degenHunterWatchlist.findMany?.({
    where: { chatId },
    orderBy: { addedAt: "desc" },
    take: 10,
  }) || [];

  if (watchlist.length === 0) {
    const text = `*📋 Your Watchlist*\n\nYour watchlist is empty.\n\nAdd tokens to your watchlist using the "👁️ Watch" button on token alerts.`;
    const keyboard = new InlineKeyboard().text("◀️ Back to Control Room", "menu_control_room");
    if (isEdit) {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
    }
    return;
  }

  const keyboard = new InlineKeyboard();
  let text = `*📋 Your Watchlist* (${watchlist.length} tokens)\n\n`;

  for (let i = 0; i < watchlist.length; i++) {
    const item = watchlist[i];
    const sym = item.tokenSymbol ?? "??";
    const name = item.tokenName ?? "Unknown";
    const chain = item.tokenChain ?? "unknown";

    // Optionally try to get live price from DexScreener (best-effort, non-blocking)
    let livePrice: string | null = null;
    if (item.pairAddress) {
      try {
        const resp = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${item.pairAddress}`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          const data = await resp.json() as any;
          const pair = data?.pair;
          if (pair?.priceUsd) livePrice = formatPrice(parseFloat(pair.priceUsd));
        }
      } catch { /* best-effort */ }
    }

    text += `${i + 1}. *${sym}* (${name})\n` +
            `   Chain: ${chain}${livePrice ? ` | Price: ${livePrice}` : ""} | Added: ${new Date(item.addedAt).toLocaleDateString()}\n\n`;

    keyboard.text(`📊 ${sym}`, buildCallbackData("chart", item.tokenAddress))
            .text(`❌ Remove`, buildCallbackData("unwatch", item.tokenAddress)).row();
  }

  keyboard.text("◀️ Back to Control Room", "menu_control_room");

  if (isEdit) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  }
}


async function handleSettings(ctx: any, isEdit: boolean = false) {
  const chatId = String(ctx.chat.id);
  let userState = userStates.get(chatId);

  if (!userState) {
    await handleStart(ctx);
    userState = userStates.get(chatId)!;
  }

  const userRecord = await safePrisma.degenHunterUser.findUnique?.({ where: { chatId } });
  if (!userRecord) {
    await ctx.editMessageText("❌ User record not found.");
    return;
  }

  const text = `*⚙️ Degen Hunter Settings*\n\n` +
    `*Alerts Enabled:* ${userRecord.alertsEnabled ? "✅ Yes" : "❌ No"}\n` +
    `*Min Score Threshold:* ${userRecord.minScoreThreshold}/100\n` +
    `*Risk Level Filter:* ${userRecord.riskLevelFilter || "all"}\n` +
    `*Notify on New Tokens:* ${userRecord.notifyOnNewTokens ? "✅ Yes" : "❌ No"}`;
    
  const keyboard = new InlineKeyboard()
    .text(userRecord.alertsEnabled ? "Disable Alerts" : "Enable Alerts", "setting_toggle_alerts")
    .text(userRecord.notifyOnNewTokens ? "Disable New Token Notify" : "Enable New Token Notify", "setting_toggle_notify").row()
    .text("-10 Score", "setting_score_dec").text("+10 Score", "setting_score_inc").row()
    .text("Toggle Risk: Low", "setting_risk_low").text("Toggle Risk: Med", "setting_risk_medium").row()
    .text("Toggle Risk: High", "setting_risk_high").row()
    .text("◀️ Back to Control Room", "menu_control_room");
  
  if (isEdit) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  }
}

async function handleMute(ctx: any) {
  const chatId = String(ctx.chat.id);
  const args = ctx.message.text.split(" ").slice(1);

  if (args.length === 0) {
    await ctx.reply(
      `*Usage:* /mute <tokenAddress>\n\n` +
      `Example: /mute EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\n\n` +
      `This will mute alerts for the specified token address.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const tokenAddress = args[0];

  // Add to muted tokens in database
  await safePrisma.degenHunterMutedToken.upsert({
    where: { chatId_tokenAddress: { chatId, tokenAddress } },
    update: { mutedAt: new Date() },
    create: { chatId, tokenAddress, mutedAt: new Date() },
  });

  // Also add to in-memory set for faster lookup
  mutedTokens.add(`${chatId}:${tokenAddress}`);

  await ctx.reply(
    `*🔇 Token Muted*\n\n` +
    `Alerts for token \`${tokenAddress}\` have been muted.\n\n` +
    `Use /unmute <tokenAddress> to restore alerts.\n` +
    `Or use the dashboard to manage your muted tokens.`,
    { parse_mode: "Markdown" }
  );
}

async function handleUnmute(ctx: any) {
  const chatId = String(ctx.chat.id);
  const args = ctx.message.text.split(" ").slice(1);

  if (args.length === 0) {
    await ctx.reply(
      `*Usage:* /unmute <tokenAddress>\n\n` +
      `Example: /unmute EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\n\n` +
      `This will unmute alerts for the specified token address.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const tokenAddress = args[0];

  // Remove from muted tokens in database
  try {
    await safePrisma.degenHunterMutedToken.delete?.({
      where: { chatId_tokenAddress: { chatId, tokenAddress } }
    });
  } catch (error) {
    // If delete doesn't exist, just ignore
    console.warn("[degen-hunter-telegram] delete operation not available for muted tokens");
  }

  // Also remove from in-memory set
  mutedTokens.delete(`${chatId}:${tokenAddress}`);

  await ctx.reply(
    `*🔊 Token Unmuted*\n\n` +
    `Alerts for token \`${tokenAddress}\` have been restored.\n\n` +
    `You will now receive alerts for this token again.`,
    { parse_mode: "Markdown" }
  );
}

async function handleDeposit(ctx: any) {
  const chatId = String(ctx.chat.id);
  const args = ctx.message.text.split(" ").slice(1);

  // Check if this is a PIN response
  let userState = userStates.get(chatId);
  if (userState && userState.awaitingPinFor === "deposit") {
    // This is a PIN response, verify it
    const pin = args[0];
    if (!pin || !/^\d{4,8}$/.test(pin)) {
      await ctx.reply(
        `*❌ Invalid PIN*\n\n` +
        `PIN must be 4-8 digits only.\n\n` +
        `Please try again with your 4-8 digit PIN.`,
        { parse_mode: "Markdown" }
      );
      // Keep waiting for PIN
      return;
    }

    // Verify PIN
    const pinCheck = await verifyPinWithLockout(chatId, pin);
    if (!pinCheck.ok) {
      await replyPinRejection(
        ctx,
        pinCheck,
        `*❌ Incorrect PIN*\n\nYour PIN is incorrect.\n\nPlease try again with your 4-8 digit PIN.`
      );
      if (pinCheck.reason === "locked" || (pinCheck.reason === "incorrect" && pinCheck.justLocked)) userStates.set(chatId, { ...userState, awaitingPinFor: undefined, pendingDepositAmount: undefined });
      // Otherwise keep waiting for PIN
      return;
    }

    // PIN verified, clear awaiting state and continue with deposit
    // We need to get the original amount from somewhere - let's store it in user state
    const amount = userState.pendingDepositAmount;
    if (!amount) {
      await ctx.reply(
        `*❌ Error*\n\n` +
        `Transaction information lost. Please start over.\n` +
        `Use /deposit <amount> to try again.`,
        { parse_mode: "Markdown" }
      );
      userStates.set(chatId, { ...userState, awaitingPinFor: undefined, pendingDepositAmount: undefined });
      return;
    }

    // Clear awaiting state
    userStates.set(chatId, { ...userState, awaitingPinFor: undefined, pendingDepositAmount: undefined });

    // Continue with normal deposit logic below
    // (We'll jump to the amount validation section)
  } else if (args.length === 0) {
    // No arguments - show usage or ask for PIN if needed
    userState = userStates.get(chatId);
    if (!userState) {
      await handleStart(ctx);
      userState = userStates.get(chatId)!;
    }

    // Check if PIN is set
    const userRecord = await safePrisma.degenHunterUser.findUnique?.({ where: { chatId } });
    const hasPin = userRecord && userRecord.pinHash;

    if (hasPin) {
      // Ask for PIN first
      await ctx.reply(
        `*🔒 PIN Required*\n\n` +
        `Please enter your PIN to verify your identity:\n` +
        `Reply with your 4-8 digit PIN`,
        { parse_mode: "Markdown" }
      );

      // Set state to expect PIN input
      userStates.set(chatId, {
        ...userState,
        awaitingPinFor: "deposit"
      });
      return;
    } else {
      // No PIN set, show help
      await ctx.reply(
        `*Usage:* /deposit <amount>\n\n` +
        `Example: /deposit 1.5\n\n` +
        `This will deposit SOL to your paper wallet.\n` +
        `Note: Set up a PIN first using /pin for security.`,
        { parse_mode: "Markdown" }
      );
      return;
    }
  } else {
    // Normal argument processing (no PIN yet)
    const amount = parseFloat(args[0]);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply(
        `*❌ Invalid Amount*\n\n` +
        `Please provide a valid positive number.\n\n` +
        `Example: /deposit 1.5`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    let userState = userStates.get(chatId);
    if (!userState) {
      await handleStart(ctx);
      userState = userStates.get(chatId)!;
    }

    // Check if PIN is set
    const userRecord = await safePrisma.degenHunterUser.findUnique?.({ where: { chatId } });
    const hasPin = userRecord && userRecord.pinHash;

    if (hasPin) {
      // PIN is set, ask for it first
      await ctx.reply(
        `*🔒 PIN Required*\n\n` +
        `Please enter your PIN to verify your identity:\n` +
        `Reply with your 4-8 digit PIN`,
        { parse_mode: "Markdown" }
      );

      // Store the amount for later and set state to expect PIN
      userStates.set(chatId, {
        ...userState,
        awaitingPinFor: "deposit",
        pendingDepositAmount: amount
      });
      return;
    }

    // No PIN set, proceed with deposit (legacy behavior)
    // Update paper wallet balance
    userState.paperWalletBalance = (userState.paperWalletBalance || 0) + amount;

    // Save to database if available
    await safePrisma.degenHunterWallet.upsert({
      where: { chatId },
      update: {
        balance: userState.paperWalletBalance,
        updatedAt: new Date()
      },
      create: {
        chatId,
        balance: userState.paperWalletBalance,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    await ctx.reply(
      `*💰 Deposit Successful*\n\n` +
      `Deposited: ${amount.toFixed(4)} SOL\n` +
      `New Balance: ${userState.paperWalletBalance.toFixed(4)} SOL\n` +
      `$${(userState.paperWalletBalance * 150).toFixed(2)}\n\n` +
      `*Note:* This is a paper trading wallet for testing purposes only.\n` +
      `No real funds are involved.`,
      { parse_mode: "Markdown" }
    );
  }
}

async function handleWithdraw(ctx: any) {
  const chatId = String(ctx.chat.id);
  const args = ctx.message.text.split(" ").slice(1);

  // Check if this is a PIN response
  let userState = userStates.get(chatId);
  if (userState && userState.awaitingPinFor === "withdraw") {
    // This is a PIN response, verify it
    const pin = args[0];
    if (!pin || !/^\d{4,8}$/.test(pin)) {
      await ctx.reply(
        `*❌ Invalid PIN*\n\n` +
        `PIN must be 4-8 digits only.\n\n` +
        `Please try again with your 4-8 digit PIN.`,
        { parse_mode: "Markdown" }
      );
      // Keep waiting for PIN
      return;
    }

    // Verify PIN
    const pinCheck = await verifyPinWithLockout(chatId, pin);
    if (!pinCheck.ok) {
      await replyPinRejection(
        ctx,
        pinCheck,
        `*❌ Incorrect PIN*\n\nYour PIN is incorrect.\n\nPlease try again with your 4-8 digit PIN.`
      );
      if (pinCheck.reason === "locked" || (pinCheck.reason === "incorrect" && pinCheck.justLocked)) userStates.set(chatId, { ...userState, awaitingPinFor: undefined, pendingWithdrawAmount: undefined });
      // Otherwise keep waiting for PIN
      return;
    }

    // PIN verified, clear awaiting state and continue with withdrawal
    // We need to get the original amount from somewhere - let's store it in user state
    const amount = userState.pendingWithdrawAmount;
    if (!amount) {
      await ctx.reply(
        `*❌ Error*\n\n` +
        `Transaction information lost. Please start over.\n` +
        `Use /withdraw <amount> to try again.`,
        { parse_mode: "Markdown" }
      );
      userStates.set(chatId, { ...userState, awaitingPinFor: undefined, pendingWithdrawAmount: undefined });
      return;
    }

    // Clear awaiting state
    userStates.set(chatId, { ...userState, awaitingPinFor: undefined, pendingWithdrawAmount: undefined });

    // Continue with normal withdrawal logic below
    // (We'll jump to the amount validation section)
  } else if (args.length === 0) {
    // No arguments - show usage or ask for PIN if needed
    userState = userStates.get(chatId);
    if (!userState) {
      await handleStart(ctx);
      userState = userStates.get(chatId)!;
    }

    // Check if PIN is set
    const userRecord = await safePrisma.degenHunterUser.findUnique?.({ where: { chatId } });
    const hasPin = userRecord && userRecord.pinHash;

    if (hasPin) {
      // Ask for PIN first
      await ctx.reply(
        `*🔒 PIN Required*\n\n` +
        `Please enter your PIN to verify your identity:\n` +
        `Reply with your 4-8 digit PIN`,
        { parse_mode: "Markdown" }
      );

      // Set state to expect PIN input
      userStates.set(chatId, {
        ...userState,
        awaitingPinFor: "withdraw"
      });
      return;
    } else {
      // No PIN set, show help
      await ctx.reply(
        `*Usage:* /withdraw <amount>\n\n` +
        `Example: /withdraw 0.5\n\n` +
        `This will withdraw SOL from your paper wallet.\n` +
        `Note: Set up a PIN first using /pin for security.`,
        { parse_mode: "Markdown" }
      );
      return;
    }
  }

  const amount = parseFloat(args[0]);
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply(
      `*❌ Invalid Amount*\n\n` +
      `Please provide a valid positive number.\n\n` +
      `Example: /withdraw 0.5`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  userState = userStates.get(chatId);
  if (!userState) {
    await handleStart(ctx);
    userState = userStates.get(chatId)!;
  }

  // Check if PIN is set
  const userRecord = await safePrisma.degenHunterUser.findUnique?.({ where: { chatId } });
  const hasPin = userRecord && userRecord.pinHash;

  if (hasPin) {
    // PIN is set, ask for it first
    await ctx.reply(
      `*🔒 PIN Required*\n\n` +
      `Please enter your PIN to verify your identity:\n` +
      `Reply with your 4-8 digit PIN`,
      { parse_mode: "Markdown" }
    );

    // Store the amount for later and set state to expect PIN
    userStates.set(chatId, {
      ...userState,
      awaitingPinFor: "withdraw",
      pendingWithdrawAmount: amount
    });
    return;
  }

  // No PIN set, proceed with withdrawal (legacy behavior)
  if ((userState.paperWalletBalance || 0) < amount) {
    await ctx.reply(
      `*❌ Insufficient Funds*\n\n` +
      `Current balance: ${(userState.paperWalletBalance || 0).toFixed(4)} SOL\n` +
      `Requested: ${amount.toFixed(4)} SOL\n\n` +
      `You don't have enough SOL in your paper wallet.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Update paper wallet balance
  userState.paperWalletBalance = (userState.paperWalletBalance || 0) - amount;

  // Save to database if available
  await safePrisma.degenHunterWallet.upsert({
    where: { chatId },
    update: {
      balance: userState.paperWalletBalance,
      updatedAt: new Date()
    },
    create: {
      chatId,
      balance: userState.paperWalletBalance,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  });

  await ctx.reply(
    `*💸 Withdrawal Successful*\n\n` +
    `Withdrew: ${amount.toFixed(4)} SOL\n` +
    `New Balance: ${userState.paperWalletBalance.toFixed(4)} SOL\n` +
    `$${(userState.paperWalletBalance * 150).toFixed(2)}\n\n` +
    `*Note:* This is a paper trading wallet for testing purposes only.\n` +
    `No real funds are involved.`,
    { parse_mode: "Markdown" }
  );
}

async function handleHistory(ctx: any, isEdit: boolean = false) {
  const chatId = String(ctx.chat.id);

  const positions = await safePrisma.degenHunterPosition.findMany?.({
    where: { chatId },
    orderBy: { createdAt: "desc" },
    take: 10,
  }) || [];

  const keyboard = new InlineKeyboard()
    .text("◀️ Back to Wallet", "menu_wallet").row()
    .text("◀️ Back to Control Room", "menu_control_room");

  if (positions.length === 0) {
    const text = `*📜 Transaction History*\n\nNo transactions found.\n\nUse the 💰 Buy button on token alerts to start trading.`;
    if (isEdit) {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
    }
    return;
  }

  const lines = positions.map((pos: any, index: number) => {
    const date = new Date(pos.createdAt).toLocaleString();
    const status = pos.status === "OPEN" ? "🟢 OPEN" : "🔴 CLOSED";
    return `${index + 1}. ${status} *${pos.tokenSymbol}*\n` +
           `   SOL: ${Number(pos.amountSOL).toFixed(4)} SOL\n` +
           `   Entry: ${formatPrice(Number(pos.entryPriceUsd))}\n` +
           `   Date: ${date}`;
  });

  const text = `*📜 Position History* (Last ${positions.length})\n\n` +
    lines.join("\n\n");

  if (isEdit) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  }
}


async function handleExportKey(ctx: any) {
  const chatId = String(ctx.chat.id);

  // Check if this is a PIN response
  let userState = userStates.get(chatId);
  if (userState && userState.awaitingPinFor === "export_key") {
    // This is a PIN response, verify it
    const pin = ctx.message.text.split(" ").slice(1)[0] || ctx.message.text; // Get first argument as PIN or the text itself if just PIN was typed
    if (!pin || !/^\d{4,8}$/.test(pin)) {
      await ctx.reply(
        `*❌ Invalid PIN*\n\n` +
        `PIN must be 4-8 digits only.\n\n` +
        `Please try again with your 4-8 digit PIN.`,
        { parse_mode: "Markdown" }
      );
      // Keep waiting for PIN
      return;
    }

    // Verify PIN
    const pinCheck = await verifyPinWithLockout(chatId, pin);
    if (!pinCheck.ok) {
      await replyPinRejection(
        ctx,
        pinCheck,
        `*❌ Incorrect PIN*\n\nYour PIN is incorrect.\n\nPlease try again with your 4-8 digit PIN.`
      );
      if (pinCheck.reason === "locked" || (pinCheck.reason === "incorrect" && pinCheck.justLocked)) userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
      // Otherwise keep waiting for PIN
      return;
    }

    // Check cooldown
    const lastExport = exportCooldowns.get(chatId) || 0;
    if (Date.now() - lastExport < 60000) {
      await ctx.reply(`⏳ *Cooldown Active*\n\nPlease wait 60 seconds between key exports.`, { parse_mode: "Markdown" });
      userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
      return;
    }

    // PIN verified, clear awaiting state and proceed with export
    userStates.set(chatId, { ...userState, awaitingPinFor: undefined });

    // Proceed with export key logic
    const privKey = await exportPrivateKey(chatId);
    if (!privKey) {
      await ctx.reply(`❌ *Failed to export key.*\nWallet not found or encryption error.`, { parse_mode: "Markdown" });
      return;
    }

    exportCooldowns.set(chatId, Date.now());

    const sentMsg = await ctx.reply(
      `*🔑 Burner Wallet Private Key*\n\n` +
      `\`${privKey}\`\n\n` +
      `⚠️ *WARNING:* Never share this key. Anyone with this key controls your funds.\n` +
      `_This message will self-destruct in ${KEY_MESSAGE_TTL_SECONDS} seconds._`,
      { parse_mode: "Markdown" }
    );

    // Persisted + retried delete (see scheduleSecureDelete)
    scheduleSecureDelete(ctx.api, chatId, sentMsg.message_id, KEY_MESSAGE_TTL_SECONDS * 1000);

    return;
  } else {
    // No arguments - ask for PIN if needed
    userState = userStates.get(chatId);
    if (!userState) {
      await handleStart(ctx);
      userState = userStates.get(chatId)!;
    }

    // Check if PIN is set
    const userRecord = await safePrisma.degenHunterUser.findUnique?.({ where: { chatId } });
    const hasPin = userRecord && userRecord.pinHash;

    if (hasPin) {
      // Ask for PIN first
      await ctx.reply(
        `*🔒 PIN Required*\n\n` +
        `Please enter your PIN to verify your identity:\n` +
        `(Just type the PIN in the chat)`,
        { parse_mode: "Markdown" }
      );

      // Set state to expect PIN input
      userStates.set(chatId, {
        ...userState,
        awaitingPinFor: "export_key"
      });
      return;
    } else {
      // No PIN set, show help
      await ctx.reply(
        `*🔑 Wallet Key Export*\n\n` +
        `You must set up a PIN first to export your private key.\n\n` +
        `Use \`/pin <4-8 digits>\` to set your secure PIN.`,
        { parse_mode: "Markdown" }
      );
      return;
    }
  }
}

// Callback query handler for inline buttons
async function handlePin(ctx: any) {
  const chatId = String(ctx.chat.id);
  const args = ctx.message.text.split(" ").slice(1);

  // Check if this is a PIN response (user is setting/changing PIN)
  let userState = userStates.get(chatId);
  if (userState && (userState.awaitingPinFor === "set_pin" || userState.awaitingPinFor === "change_pin_old" || userState.awaitingPinFor === "change_pin_new")) {
    // This is a PIN response, process it
    const pin = args[0];
    if (!pin || !/^\d{4,8}$/.test(pin)) {
      await ctx.reply(
        `*❌ Invalid PIN*\n\n` +
        `PIN must be 4-8 digits only.\n\n` +
        `Please try again with your 4-8 digit PIN.`,
        { parse_mode: "Markdown" }
      );
      // Keep waiting for PIN
      return;
    }

    // Verify PIN based on what we're waiting for
    if (userState.awaitingPinFor === "set_pin") {
      // User is setting PIN for the first time
      const userRecord = await safePrisma.degenHunterUser.findUnique?.({ where: { chatId } });
      if (userRecord && userRecord.pinHash) {
        // User already has a PIN, this shouldn't happen but handle gracefully
        await ctx.reply(
          `*⚠️ PIN Already Set*\n\n` +
          `You already have a PIN set. Use /change_pin to change it.\n\n` +
          `To reset your PIN, you would need to contact an administrator.\n`,
          { parse_mode: "Markdown" }
        );
        userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
        return;
      }

      // Hash and store the new PIN
      const pinHash = hashPin(pin);
      await safePrisma.degenHunterUser.upsert({
        where: { chatId },
        update: { pinHash },
        create: { chatId, pinHash, username: ctx.chat.username || ctx.chat.first_name || "User", lastActive: new Date() }
      });

      // Clear awaiting state
      userStates.set(chatId, { ...userState, awaitingPinFor: undefined, pinSet: true });

      await ctx.reply(
        `*🔒 PIN Set Successfully*\n\n` +
        `Your PIN has been set and will be required for wallet operations.\n\n` +
        `Use /change_pin to change your PIN in the future.\n`,
        { parse_mode: "Markdown" }
      );
      return;
    }
    else if (userState.awaitingPinFor === "change_pin_old") {
      // User provided old PIN for change, now ask for new one
      const pinCheck = await verifyPinWithLockout(chatId, pin);
      if (!pinCheck.ok) {
        await replyPinRejection(
          ctx,
          pinCheck,
          `*❌ Incorrect PIN*\n\nYour current PIN is incorrect.\n\nPlease try again with your current 4-8 digit PIN.`
        );
        if (pinCheck.reason === "locked" || (pinCheck.reason === "incorrect" && pinCheck.justLocked)) userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
        // Otherwise keep waiting for old PIN
        return;
      }

      // Old PIN verified, now ask for new PIN
      await ctx.reply(
        `*🔒 Enter New PIN*\n\n` +
        `Please enter your new 4-8 digit PIN:`,
        { parse_mode: "Markdown" }
      );

      // Set state to expect new PIN
      userStates.set(chatId, {
        ...userState,
        awaitingPinFor: "change_pin_new"
      });
      return;
    }
    else if (userState.awaitingPinFor === "change_pin_new") {
      // User provided new PIN, verify and set it
      const userRecord = await safePrisma.degenHunterUser.findUnique?.({ where: { chatId } });
      if (!userRecord || !userRecord.pinHash) {
        await ctx.reply(
          `*❌ Error*\n\n` +
          `Could not find your account. Please try /start to reinitialize.\n`,
          { parse_mode: "Markdown" }
        );
        userStates.set(chatId, { ...userState, awaitingPinFor: undefined });
        return;
      }

      // Hash and store the new PIN
      const pinHash = hashPin(pin);
      await safePrisma.degenHunterUser.upsert({
        where: { chatId },
        update: { pinHash },
        create: { chatId, pinHash, username: userRecord.username, lastActive: new Date() }
      });

      // Clear awaiting state
      userStates.set(chatId, { ...userState, awaitingPinFor: undefined });

      await ctx.reply(
        `*🔒 PIN Changed Successfully*\n\n` +
        `Your PIN has been changed and will be required for future wallet operations.\n`,
        { parse_mode: "Markdown" }
      );
      return;
    }
  }

  // No arguments or not in PIN flow - show usage or ask for PIN if needed
  userState = userStates.get(chatId);
  if (!userState) {
    await handleStart(ctx);
    userState = userStates.get(chatId)!;
  }

  // Check if PIN is already set
  const userRecord = await safePrisma.degenHunterUser.findUnique?.({ where: { chatId } });
  const hasPin = userRecord && userRecord.pinHash;

  if (hasPin) {
    // Ask for current PIN first
    await ctx.reply(
      `*🔒 PIN Required*\n\n` +
      `Please enter your current 4-8 digit PIN to change it:`,
      { parse_mode: "Markdown" }
    );

    // Set state to expect current PIN for change
    userStates.set(chatId, {
      ...userState,
      awaitingPinFor: "change_pin_old"
    });
    return;
  } else {
    // No PIN set, ask to set new PIN
    await ctx.reply(
      `*🔒 Set New PIN*\n\n` +
      `Please enter a 4-8 digit PIN to secure your wallet:`,
      { parse_mode: "Markdown" }
    );

    // Set state to expect new PIN
    userStates.set(chatId, {
      ...userState,
      awaitingPinFor: "set_pin"
    });
    return;
  }
}

async function handleChangePin(ctx: any) {
  // This is just an alias for handlePin - the logic determines if we're setting or changing
  await handlePin(ctx);
}
async function handleCallbackQuery(ctx: any) {
  await ctx.answerCallbackQuery(); // Acknowledge the button press immediately

  const chatId = String(ctx.chat.id);
  const data = ctx.callbackQuery.data;
  const messageId = ctx.callbackQuery.message.message_id;

  if (!data) return;

  // Parse callback data
  const [action, shortId, param3] = data.split(":");
  const tokenId = shortId ? resolveShortId(shortId) : "";

  // Handle actions without a tokenId (Menu navigation)
  if (!tokenId) {
    try {
      switch (action) {
        case "menu_control_room":
          await sendControlRoom(ctx, true);
          break;
        case "menu_wallet":
          await handleWallet(ctx, true);
          break;
        case "menu_watchlist":
          await handleWatchlist(ctx, true);
          break;
        case "menu_settings":
          await handleSettings(ctx, true);
          break;
        case "menu_status":
          await handleStatus(ctx, true);
          break;
        case "menu_history":
          await handleHistory(ctx, true);
          break;
        case "menu_alerts":
          await handleAlertsMenu(ctx, true);
          break;
        case "action_deposit":
          await handleDepositAction(ctx);
          break;
        case "action_withdraw":
          await handleWithdrawAction(ctx);
          break;
        case "action_export_key":
          await handleExportKeyAction(ctx);
          break;
        case "action_create_wallet":
          await handleCreateWalletAction(ctx);
          break;
        case "action_confirm_create_wallet":
          await handleConfirmCreateWallet(ctx);
          break;
        case "action_history":
          await handleHistory(ctx, true);
          break;
        case "action_positions":
          await handlePositionsAction(ctx);
          break;
        case "setting_toggle_alerts":
          await handleSettingToggleAlerts(ctx);
          break;
        case "setting_toggle_notify":
          await handleSettingToggleNotify(ctx);
          break;
        case "setting_score_inc":
          await handleSettingScore(ctx, 10);
          break;
        case "setting_score_dec":
          await handleSettingScore(ctx, -10);
          break;
        case "setting_risk_low":
          await handleSettingRisk(ctx, "low");
          break;
        case "setting_risk_medium":
          await handleSettingRisk(ctx, "medium");
          break;
        case "setting_risk_high":
          await handleSettingRisk(ctx, "high");
          break;
        default:
          await ctx.editMessageText("❌ Unknown menu action.", {
            reply_markup: new InlineKeyboard().text("◀️ Back to Control Room", "menu_control_room")
          });
      }
    } catch (error) {
      console.error("[degen-hunter-telegram] Error handling menu callback:", error);
    }
    return;
  }

  try {
    switch (action) {
      case "chart":
        await handleChartButton(ctx, tokenId);
        break;
      case "details":
        await handleDetailsButton(ctx, tokenId);
        break;
      case "watch":
        await handleWatchButton(ctx, tokenId, chatId);
        break;
      case "unwatch":
        await handleUnwatchButton(ctx, tokenId, chatId);
        break;
      case "ignore":
        await handleIgnoreButton(ctx, tokenId, chatId);
        break;
      case "buy":
        await handleBuyButton(ctx, tokenId, chatId);
        break;
      case "buy_amount":
        await handleBuyAmount(ctx, tokenId, chatId, param3);
        break;
      case "sell":
        await handleSellButton(ctx, tokenId, chatId);
        break;
      case "sell_amount":
        await handleSellAmount(ctx, tokenId, chatId, param3);
        break;
      case "mute":
        await handleMuteButton(ctx, tokenId, chatId);
        break;
      default:
        await ctx.editMessageText("❌ Unknown action. Please try again.");
    }
  } catch (error) {
    console.error("[degen-hunter-telegram] Error handling callback query:", error);
    await ctx.editMessageText("❌ An error occurred. Please try again.");
  }
}

// Action button handlers
async function handleAlertsMenu(ctx: any, isEdit: boolean = true) {
  const text = `🔥 *Token Alerts*\n\nAlerts are pushed automatically when new tokens are found based on your risk settings.\n\nCheck your Watchlist for saved tokens.`;
  const keyboard = new InlineKeyboard().text("◀️ Back to Control Room", "menu_control_room");
  if (isEdit) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  }
}

async function handleDepositAction(ctx: any) {
  await ctx.editMessageText(`📥 *Deposit SOL*\n\nTo deposit, please reply with the command:\n\n\`/deposit <amount>\`\n\n(e.g., \`/deposit 100\`)`, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard().text("◀️ Back to Wallet", "menu_wallet")
  });
}

async function handleWithdrawAction(ctx: any) {
  await ctx.editMessageText(`📤 *Withdraw SOL*\n\nTo withdraw, please reply with the command:\n\n\`/withdraw <amount>\`\n\n(e.g., \`/withdraw 50\`)`, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard().text("◀️ Back to Wallet", "menu_wallet")
  });
}

async function handleExportKeyAction(ctx: any) {
  const chatId = String(ctx.chat.id);

  // Check cooldown before asking for PIN
  const lastExport = exportCooldowns.get(chatId) || 0;
  if (Date.now() - lastExport < 60000) {
    const secsLeft = Math.ceil((60000 - (Date.now() - lastExport)) / 1000);
    await ctx.editMessageText(
      `⏳ *Export Cooldown*\n\nYou must wait *${secsLeft}s* before exporting again.`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Back to Wallet", "menu_wallet") }
    );
    return;
  }

  // Check wallet exists
  const wallet = await safePrisma.degenHunterWallet.findUnique?.({ where: { chatId } });
  if (!wallet?.publicKey) {
    await ctx.editMessageText(
      `❌ *No Burner Wallet*\n\nYou haven't created a burner wallet yet.\n\nGo back and generate one first.`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Back to Wallet", "menu_wallet") }
    );
    return;
  }

  // Check PIN is set
  const userRecord = await safePrisma.degenHunterUser.findUnique?.({ where: { chatId } });
  if (!userRecord?.pinHash) {
    await ctx.editMessageText(
      `🔒 *PIN Required*\n\nYou must set a PIN before exporting your key.\n\nGo to: Wallet → Security → Set PIN`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Back to Wallet", "menu_wallet") }
    );
    return;
  }

  // Set state to expect PIN in the next text message
  let userState = userStates.get(chatId);
  if (!userState) {
    userState = { paperWalletBalance: 0, pinSet: !!userRecord?.pinHash };
  }
  userStates.set(chatId, { ...userState, awaitingPinFor: "export_key" });

  await ctx.editMessageText(
    `🔐 *Export Private Key*\n\n` +
    `Enter your PIN in the chat to decrypt and display your burner wallet private key.\n\n` +
    `⚠️ The key will be shown for *${KEY_MESSAGE_TTL_SECONDS} seconds* then deleted automatically.`,
    { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Cancel", "menu_wallet") }
  );
}

async function handleCreateWalletAction(ctx: any) {
  // Step 1: Confirmation screen before creating
  const text = `🔐 *Generate Burner Wallet*\n\n` +
    `Please read before confirming:\n\n` +
    `• This is a *real Solana burner wallet* for Degen Hunter only\n` +
    `• It is completely separate from your main Solana wallet\n` +
    `• Your private key will be stored securely on the backend, encrypted at rest\n\n` +
    `Do you want to generate your burner wallet now?`;

  const keyboard = new InlineKeyboard()
    .text("✅ Yes, generate my wallet", "action_confirm_create_wallet").row()
    .text("◀️ Cancel", "menu_wallet");

  await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
}

async function handlePositionsAction(ctx: any) {
  const chatId = String(ctx.chat.id);
  const openPositions = await safePrisma.degenHunterPosition.findMany?.({
    where: { chatId, status: "OPEN" }
  }) || [];

  if (openPositions.length === 0) {
    await ctx.editMessageText(
      `📊 *Open Positions*\n\nYou currently have no open positions.\n\nUse the 💰 Buy button on token alerts to start trading.`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Back to Wallet", "menu_wallet") }
    );
    return;
  }

  let text = `📊 *Open Positions*\n\n`;
  let totalInvestedSOL = 0;

  for (const pos of openPositions) {
    const entryPrice = Number(pos.entryPriceUsd);
    const amountSOL = Number(pos.amountSOL);
    text += `*${pos.tokenSymbol}*\n`;
    text += `   SOL In: ${amountSOL.toFixed(4)} SOL\n`;
    text += `   Entry: ${formatPrice(entryPrice)}\n\n`;
    totalInvestedSOL += amountSOL;
  }

  text += `*Total Capital Deployed:* ${totalInvestedSOL.toFixed(4)} SOL`;

  const keyboard = new InlineKeyboard();
  for (const pos of openPositions) {
    keyboard.text(`Sell ${pos.tokenSymbol}`, buildCallbackData("chart", pos.tokenAddress)).row();
  }
  keyboard.text("◀️ Back to Wallet", "menu_wallet");

  await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
}

async function handleSettingToggleAlerts(ctx: any) {
  const chatId = String(ctx.chat.id);
  const user = await safePrisma.degenHunterUser.findUnique?.({ where: { chatId } });
  if (user) {
    await safePrisma.degenHunterUser.upsert({
      where: { chatId },
      update: { alertsEnabled: !user.alertsEnabled },
      create: { chatId }
    });
    await handleSettings(ctx, true);
  }
}

async function handleSettingToggleNotify(ctx: any) {
  const chatId = String(ctx.chat.id);
  const user = await safePrisma.degenHunterUser.findUnique?.({ where: { chatId } });
  if (user) {
    await safePrisma.degenHunterUser.upsert({
      where: { chatId },
      update: { notifyOnNewTokens: !user.notifyOnNewTokens },
      create: { chatId }
    });
    await handleSettings(ctx, true);
  }
}

async function handleSettingScore(ctx: any, change: number) {
  const chatId = String(ctx.chat.id);
  const user = await safePrisma.degenHunterUser.findUnique?.({ where: { chatId } });
  if (user) {
    let newScore = (user.minScoreThreshold || 0) + change;
    newScore = Math.max(0, Math.min(100, newScore));
    await safePrisma.degenHunterUser.upsert({
      where: { chatId },
      update: { minScoreThreshold: newScore },
      create: { chatId }
    });
    await handleSettings(ctx, true);
  }
}

async function handleSettingRisk(ctx: any, risk: string) {
  const chatId = String(ctx.chat.id);
  const user = await safePrisma.degenHunterUser.findUnique?.({ where: { chatId } });
  if (user) {
    let risks = user.riskLevelFilter ? user.riskLevelFilter.split(",").filter((r: string) => r) : [];
    if (risks.includes(risk)) {
      risks = risks.filter((r: string) => r !== risk);
    } else {
      risks.push(risk);
    }
    const newValue = risks.length > 0 ? risks.join(",") : null;
    await safePrisma.degenHunterUser.upsert({
      where: { chatId },
      update: { riskLevelFilter: newValue },
      create: { chatId }
    });
    await handleSettings(ctx, true);
  }
}

async function handleConfirmCreateWallet(ctx: any) {
  const chatId = String(ctx.chat.id);

  // Guard: don't create a second wallet if one already exists
  const existing = await safePrisma.degenHunterWallet.findUnique?.({ where: { chatId } });
  if (existing && existing.publicKey) {
    await handleWallet(ctx, true);
    return;
  }

  try {
    const { publicKey } = await createBurnerWallet(chatId);

    log("degen-hunter-telegram", "info", `Burner wallet generated for chat ${chatId}`);

    const text = `✅ *Burner Wallet Generated!*\n\n` +
      `Your Degen Hunter burner wallet is ready.\n\n` +
      `*Address:* \`${publicKey}\`\n\n` +
      `You can now deposit SOL to this address to start trading.\n` +
      `Protect your PIN, as it will be required to export your private key or execute trades.`;

    const keyboard = new InlineKeyboard()
      .text("💰 Go to Wallet", "menu_wallet").row()
      .text("◀️ Back to Control Room", "menu_control_room");

    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
  } catch (error) {
    console.error("[degen-hunter-telegram] Failed to create wallet:", error);
    await ctx.editMessageText(
      `❌ *Wallet generation failed.*\n\nPlease try again from the Wallet menu.`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("◀️ Back to Wallet", "menu_wallet")
      }
    );
  }
}

// Individual button handlers
async function handleChartButton(ctx: any, tokenId: string) {
  // Get token from recent tokens storage
  let token = recentTokens.get(tokenId);

  // If not in memory, try to fetch from database
  if (!token) {
    const storedToken = await safePrisma.degenHunterRecentToken.findUnique?.({ where: { tokenId: tokenId } });
    if (storedToken && storedToken.tokenData) {
      try {
        token = JSON.parse(storedToken.tokenData) as DegenToken;
        // Cache it in memory for faster access
        recentTokens.set(tokenId, token);
      } catch (error) {
        console.error("[degen-hunter-telegram] Error parsing token data:", error);
      }
    }
  }

  if (!token) {
    await ctx.editMessageText("❌ Token data not found. The token may be too old.");
    return;
  }

  // In a real implementation, we'd fetch the token data and generate a chart link
  // For now, we'll provide a DexScreener link
  const chartUrl = token.dexUrl || `https://dexscreener.com/solana/${token.contractAddress}`;

  await ctx.editMessageText(
    `*📊 Token Chart*\n\n` +
    `View live chart for ${token.symbol}:\n` +
    `${chartUrl}\n\n` +
    `*Note:* Chart data is provided by DexScreener and may be delayed.`,
    {
      parse_mode: "Markdown",
      disable_web_page_preview: false
    }
  );
}

async function handleDetailsButton(ctx: any, tokenId: string) {
  // Get token from recent tokens storage
  let token = recentTokens.get(tokenId);

  // If not in memory, try to fetch from database
  if (!token) {
    const storedToken = await safePrisma.degenHunterRecentToken.findUnique?.({ where: { tokenId: tokenId } });
    if (storedToken && storedToken.tokenData) {
      try {
        token = JSON.parse(storedToken.tokenData) as DegenToken;
        // Cache it in memory for faster access
        recentTokens.set(tokenId, token);
      } catch (error) {
        console.error("[degen-hunter-telegram] Error parsing token data:", error);
      }
    }
  }

  if (!token) {
    await ctx.editMessageText("�Token data not found. The token may be too old.");
    return;
  }

  const ageMinutes = Math.floor((Date.now() - new Date(token.discoveredAt).getTime()) / 60000);
  const detailRisk = riskSummary(token); // re-derived, so tokens stored before this fix show a consistent level too

  await ctx.editMessageText(
    `*📋 Token Details*\n\n` +
    `*${token.name}* ($${token.symbol})\n` +
    `Chain: ${token.chain || "Unknown"}\n` +
    `Contract: \`${token.contractAddress}\`\n` +
    `Age: ${ageMinutes >= 0 ? ageMinutes + " minutes" : "Unknown"}\n\n` +
    `*💰 Market Data*\n` +
    `Price: ${formatPrice(token.priceUsd)}\n` +
    `Market Cap: ${token.marketCapUsd ? "$" + token.marketCapUsd.toLocaleString() : "Unknown"}\n` +
    `FDV: ${token.fdvUsd ? "$" + token.fdvUsd.toLocaleString() : "Unknown"}\n` +
    `Liquidity: ${token.liquidityUsd ? "$" + token.liquidityUsd.toLocaleString() : "Unknown"}\n` +
    `Volume 24h: ${token.volume24hUsd ? "$" + token.volume24hUsd.toLocaleString() : "Unknown"}\n\n` +
    `*📈 Trading Activity*\n` +
    `Buys 24h: ${token.buys24h?.toLocaleString() ?? "Unknown"}\n` +
    `Sells 24h: ${token.sells24h?.toLocaleString() ?? "Unknown"}\n` +
    `Buy/Sell Ratio: ${token.buys24h && token.sells24h ? (token.buys24h / token.sells24h).toFixed(2) : "Unknown"}\n\n` +
    `*🛡️ Risk Analysis*\n` +
    `Opportunity Score: ${token.totalScore ?? "Unknown"}/100\n` +
    `Risk Level: ${detailRisk.level}\n` +
    `Risk Flags: ${detailRisk.flags}\n\n` +
    `*⚠️ Warnings*\n` +
    `${detailRisk.warnings.length ? detailRisk.warnings.map(w => `• ${w}`).join("\n") : "None"}\n\n` +
    `*🔍 Evidence*\n` +
    `${detailRisk.evidence.length ? detailRisk.evidence.map(e => `• ${e}`).join("\n") : "None"}\n` +
    (detailRisk.unverified ? `\n*ℹ️ Not verified:* ${detailRisk.unverified}` : ""),
    { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Back to Token", buildCallbackData("chart", tokenId)) }
  );
}

async function handleWatchButton(ctx: any, tokenId: string, chatId: string) {
  // Get token from recent tokens storage
  let token = recentTokens.get(tokenId);

  // If not in memory, try to fetch from database
  if (!token) {
    const storedToken = await safePrisma.degenHunterRecentToken.findUnique?.({ where: { tokenId: tokenId } });
    if (storedToken && storedToken.tokenData) {
      try {
        token = JSON.parse(storedToken.tokenData) as DegenToken;
        // Cache it in memory for faster access
        recentTokens.set(tokenId, token);
      } catch (error) {
        console.error("[degen-hunter-telegram] Error parsing token data:", error);
      }
    }
  }

  if (!token) {
    await ctx.editMessageText("❌ Token data not found. The token may be too old.");
    return;
  }

  // Add to watchlist with durable identity
  await safePrisma.degenHunterWatchlist.upsert({
    where: { chatId_tokenAddress: { chatId, tokenAddress: token.contractAddress } },
    update: {
      addedAt: new Date(),
      // Refresh identity data in case it changed
      tokenName: token.name,
      tokenSymbol: token.symbol,
      tokenChain: token.chain,
      pairAddress: token.pairAddress,
      discoverySource: token.discoverySource,
    },
    create: {
      chatId,
      tokenAddress: token.contractAddress,
      tokenName: token.name,
      tokenSymbol: token.symbol,
      tokenChain: token.chain,
      pairAddress: token.pairAddress ?? null,
      discoverySource: token.discoverySource ?? null,
      addedAt: new Date(),
    },
  });
  await setWatchBaseline(chatId, token.contractAddress, token.priceUsd);

  await ctx.editMessageText(
    `*👁️ Token Added to Watchlist*\n\n` +
    `${token.symbol} has been added to your watchlist.\n\n` +
    `Use /watchlist to view all your watched tokens.`,
    { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Back to Watchlist", "menu_watchlist") }
  );
}

async function handleUnwatchButton(ctx: any, tokenId: string, chatId: string) {
  const chatIdStr = String(chatId);
  
  await safePrisma.degenHunterWatchlist.delete?.({
    where: { chatId_tokenAddress: { chatId: chatIdStr, tokenAddress: tokenId } }
  });

  await ctx.editMessageText(
    `*👁️ Token Removed*\n\nThe token has been removed from your watchlist.`,
    { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Back to Watchlist", "menu_watchlist") }
  );
}

async function handleIgnoreButton(ctx: any, tokenId: string, chatId: string) {
  // Get token from recent tokens storage
  let token = recentTokens.get(tokenId);

  // If not in memory, try to fetch from database
  if (!token) {
    const storedToken = await safePrisma.degenHunterRecentToken.findUnique?.({ where: { tokenId: tokenId } });
    if (storedToken && storedToken.tokenData) {
      try {
        token = JSON.parse(storedToken.tokenData) as DegenToken;
        // Cache it in memory for faster access
        recentTokens.set(tokenId, token);
      } catch (error) {
        console.error("[degen-hunter-telegram] Error parsing token data:", error);
      }
    }
  }

  if (!token) {
    await ctx.editMessageText("❌ Token data not found. The token may be too old.");
    return;
  }

  // Add to ignored tokens
  await safePrisma.degenHunterIgnoredToken.upsert({
    where: { chatId_tokenAddress: { chatId, tokenAddress: token.contractAddress } },
    update: { ignoredAt: new Date() },
    create: {
      chatId,
      tokenAddress: token.contractAddress,
      ignoredAt: new Date(),
    },
  });

  await ctx.editMessageText(
    `*🚫 Token Ignored*\n\n` +
    `${token.symbol} has been added to your ignore list.\n` +
    `You will no longer receive alerts for this token.\n\n` +
    `Use the dashboard to manage your ignored tokens.`,
    { parse_mode: "Markdown" }
  );
}

async function handleBuyButton(ctx: any, tokenId: string, chatId: string) {
  // Get token from recent tokens storage
  let token = recentTokens.get(tokenId);

  // If not in memory, try to fetch from database
  if (!token) {
    const storedToken = await safePrisma.degenHunterRecentToken.findUnique?.({ where: { tokenId: tokenId } });
    if (storedToken && storedToken.tokenData) {
      try {
        token = JSON.parse(storedToken.tokenData) as DegenToken;
        // Cache it in memory for faster access
        recentTokens.set(tokenId, token);
      } catch (error) {
        console.error("[degen-hunter-telegram] Error parsing token data:", error);
      }
    }
  }

  if (!token) {
    await ctx.editMessageText("❌ Token data not found. The token may be too old.");
    return;
  }

  const chatIdStr = String(chatId);
  let userState = userStates.get(chatIdStr);

  if (!userState) {
    // Initialize user state if not exists
    await handleStart({
      ...ctx,
      message: { text: "/start" },
      chat: { id: parseInt(chatIdStr) }
    } as any);
    userState = userStates.get(chatIdStr)!;
  }

  // Ensure wallet exists before trading
  const walletRecord = await safePrisma.degenHunterWallet.findUnique?.({ where: { chatId: chatIdStr } }) || null;
  if (!walletRecord || !walletRecord.publicKey) {
    await ctx.editMessageText(
      `❌ *No Wallet Found*\n\nYou must generate a burner wallet before you can trade.`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("💰 Go to Wallet", "menu_wallet")
      }
    );
    return;
  }

  const balance = await getSolBalance(chatIdStr);

  const text = `💰 *Buy ${token.symbol}*\n\n` +
    `*Available Balance:* ${balance.toFixed(4)} SOL\n` +
    `*Current Price:* ${formatPrice(token.priceUsd ?? 0)}\n\n` +
    `Select amount to buy:`;

  const keyboard = new InlineKeyboard()
    .text("0.1 SOL", buildCallbackData("buy_amount", tokenId, "0.1")).text("0.5 SOL", buildCallbackData("buy_amount", tokenId, "0.5")).row()
    .text("1 SOL", buildCallbackData("buy_amount", tokenId, "1")).text("2 SOL", buildCallbackData("buy_amount", tokenId, "2")).row()
    .text("5 SOL", buildCallbackData("buy_amount", tokenId, "5")).text("10 SOL", buildCallbackData("buy_amount", tokenId, "10")).row()
    .text("✏️ Custom", buildCallbackData("buy_amount", tokenId, "custom")).row()
    .text("◀️ Cancel", buildCallbackData("chart", tokenId));

  await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
}

async function handleBuyAmount(ctx: any, tokenId: string, chatId: string, amountStr: string) {
  const chatIdStr = String(chatId);
  
  if (amountStr === "custom") {
    let userState = userStates.get(chatIdStr);
    if (!userState) userState = {};
    userStates.set(chatIdStr, { ...userState, awaitingPinFor: `custom_buy:${tokenId}` });
    await ctx.editMessageText(
      `✏️ *Custom Buy Amount*\n\nPlease type the amount of SOL you want to spend on this token in the chat:`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Cancel", buildCallbackData("chart", tokenId)) }
    );
    return;
  }

  let token = await getTokenById(tokenId);
  if (!token) {
    await ctx.editMessageText("❌ Token data not found. The token may be too old.");
    return;
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    await ctx.editMessageText("❌ Invalid amount.");
    return;
  }

  const walletRecord = await safePrisma.degenHunterWallet.findUnique?.({ where: { chatId: chatIdStr } });
  if (!walletRecord || !walletRecord.publicKey) {
    await ctx.editMessageText("❌ No Wallet Found.");
    return;
  }

  const balance = await getSolBalance(chatIdStr);
  if (balance < amount) {
    await ctx.editMessageText(
      `❌ *Insufficient Balance*\n\n` +
      `You need ${amount} SOL but only have ${balance.toFixed(4)} SOL.\n\n` +
      `Deposit SOL to \`${walletRecord.publicKey}\` to trade.`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Cancel", buildCallbackData("chart", tokenId)) }
    );
    return;
  }

  // Find out now — before a PIN is asked for — whether Jupiter can route this at all.
  const route = await checkTradable(token.contractAddress, Math.floor(amount * 1e9));
  if (!route.tradable) {
    await ctx.editMessageText(
      `🚫 *Can't buy ${token.symbol} right now*\n\n${route.reason}`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Back", buildCallbackData("chart", tokenId)) }
    );
    return;
  }
  const impactNote =
    route.priceImpactPct != null && route.priceImpactPct >= 5
      ? `⚠️ *High price impact: ${route.priceImpactPct.toFixed(1)}%*. This amount will move the price against you.\n\n`
      : "";

  const usdValue = amount * await getSolPriceUsd();

  const text = `💰 *Review Trade*\n\n` +
    `*Action:* BUY\n` +
    `*Token:* ${token.symbol}\n` +
    `*Entry Price:* ${formatPrice(token.priceUsd ?? 0)}\n` +
    `*Amount:* ${amount} SOL (~$${usdValue.toFixed(2)})\n` +
    `*Slippage:* 0.5%\n\n` +
    impactNote +
    `*Balance After Trade:* ${(balance - amount).toFixed(4)} SOL\n\n` +
    `🔐 *Enter your PIN in the chat below to execute this trade.*`;

  const keyboard = new InlineKeyboard()
    .text("◀️ Cancel", buildCallbackData("buy", tokenId));

  let userState = userStates.get(chatIdStr) || {};
  userStates.set(chatIdStr, { 
    ...userState, 
    awaitingPinFor: `buy_confirm:${tokenId}:${amount}`,
  });

  await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
}

const HARD_SPEND_LIMIT_SOL = 1.0; // Hard cap per trade
const SOL_MINT = "So11111111111111111111111111111111111111112";

async function handleBuyConfirm(ctx: any, tokenId: string, chatId: string, amountStr: string) {
  let token = await getTokenById(tokenId);
  if (!token) {
    await ctx.editMessageText("❌ Token data not found. The token may be too old.");
    return;
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    await ctx.editMessageText("❌ Invalid amount.");
    return;
  }

  // Hard spending limit check
  if (amount > HARD_SPEND_LIMIT_SOL) {
    await ctx.editMessageText(
      `❌ *Trade Rejected*\n\nAmount exceeds hard spending limit of ${HARD_SPEND_LIMIT_SOL} SOL per trade.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const chatIdStr = String(chatId);
  const walletRecord = await safePrisma.degenHunterWallet.findUnique?.({ where: { chatId: chatIdStr } });
  if (!walletRecord || !walletRecord.publicKey) {
    await ctx.editMessageText("❌ No burner wallet found. Use /wallet to create one.");
    return;
  }

  // Fetch real balance
  const solBalance = await getSolBalance(chatIdStr);
  if (solBalance < amount) {
    await ctx.editMessageText(
      `❌ *Insufficient Balance*\n\n` +
      `You need ${amount} SOL but only have ${solBalance.toFixed(4)} SOL in your burner wallet.\n\n` +
      `Deposit SOL to \`${walletRecord.publicKey}\` to continue.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  await ctx.editMessageText(`⏳ *Executing Buy...*\n\nSending ${amount} SOL → ${token.symbol}`, { parse_mode: "Markdown" });

  try {
    // Convert SOL to lamports (1 SOL = 1e9 lamports)
    const lamports = Math.floor(amount * 1e9);
    const { txid, quoteResponse } = await executeJupiterSwap(chatIdStr, SOL_MINT, token.contractAddress, lamports);

    // Record the position from the actual fill: tokens received (the quote's
    // output, in the token's real decimals) and what that cost in USD. That's the
    // true entry price, slippage included. Falls back to the scanner's price only
    // if the quote has no output amount.
    const solUsd = await getSolPriceUsd();
    const decimals = await getTokenDecimals(token.contractAddress);
    const filledTokens = quoteResponse?.outAmount ? Number(quoteResponse.outAmount) / Math.pow(10, decimals) : 0;
    const estimatedTokens = filledTokens > 0
      ? filledTokens
      : token.priceUsd && token.priceUsd > 0 ? (amount * solUsd) / token.priceUsd : 0;
    const entryPriceUsd = filledTokens > 0 ? (amount * solUsd) / filledTokens : token.priceUsd || 0;

    await safePrisma.degenHunterPosition.create?.({
      data: {
        chatId: chatIdStr,
        tokenAddress: token.contractAddress,
        tokenSymbol: token.symbol,
        tokenAmount: estimatedTokens,
        amountSOL: amount,
        entryPriceUsd,
        status: "OPEN",
      }
    });

    await ctx.api.editMessageText(
      chatIdStr, ctx.callbackQuery?.message?.message_id,
      `*✅ Buy Executed!*\n\n` +
      `Bought: ${amount.toFixed(4)} SOL of ${token.symbol}\n` +
      `Price: ${formatPrice(token.priceUsd ?? 0)}\n\n` +
      `*TX:* \`${txid}\`\n` +
      `https://solscan.io/tx/${txid}`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Back to Token", buildCallbackData("chart", tokenId)) }
    );
  } catch (err: any) {
    const msg = err?.message || String(err);
    const failure = classifyTradeError(msg); // names what failed; the old 0x1 text match blamed SOL for slippage and token-balance errors
    await ctx.api.editMessageText(
      chatIdStr, ctx.callbackQuery?.message?.message_id,
      `❌ *Transaction Failed*\n\n` +
      (failure.kind === "sol-for-fees"
        ? `${failure.message}\nDeposit SOL to \`${walletRecord.publicKey}\`.`
        : failure.kind === "other"
          ? `Error: ${msg.substring(0, 200)}`
          : failure.message),
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Back to Token", buildCallbackData("chart", tokenId)) }
    );
  }
}

async function getSolPriceUsd(): Promise<number> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const data = await res.json() as any;
    return data?.solana?.usd || 150;
  } catch {
    return 150; // fallback
  }
}

async function getUserTokenPosition(chatId: string, tokenAddress: string) {
  const position = await safePrisma.degenHunterPosition.findFirst?.({
    where: { chatId, tokenAddress, status: "OPEN" }
  });

  return position ? Number(position.amountSOL) : 0;
}

async function handleSellButton(ctx: any, tokenId: string, chatId: string) {
  let token = await getTokenById(tokenId);
  if (!token) {
    await ctx.editMessageText("❌ Token data not found.");
    return;
  }

  const positionSol = await getUserTokenPosition(String(chatId), token.contractAddress);
  
  if (positionSol <= 0.000001) {
    await ctx.editMessageText(
      `❌ *No Position Found*\n\nYou do not have an open position for ${token.symbol}.`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Back to Token", buildCallbackData("chart", tokenId)) }
    );
    return;
  }

  const usdValue = positionSol * (token.priceUsd || 0);

  const text = `📉 *Sell ${token.symbol}*\n\n` +
    `*Your Position:* ${positionSol.toFixed(4)} SOL (~$${usdValue.toFixed(2)})\n` +
    `*Current Price:* ${formatPrice(token.priceUsd ?? 0)}\n\n` +
    `Select amount to sell:`;

  const keyboard = new InlineKeyboard()
    .text("25%", buildCallbackData("sell_amount", tokenId, "25")).text("50%", buildCallbackData("sell_amount", tokenId, "50")).row()
    .text("75%", buildCallbackData("sell_amount", tokenId, "75")).text("100%", buildCallbackData("sell_amount", tokenId, "100")).row()
    .text("✏️ Custom %", buildCallbackData("sell_amount", tokenId, "custom")).row()
    .text("◀️ Cancel", buildCallbackData("chart", tokenId));

  await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
}

async function handleSellAmount(ctx: any, tokenId: string, chatId: string, percentStr: string) {
  const chatIdStr = String(chatId);
  
  if (percentStr === "custom") {
    let userState = userStates.get(chatIdStr);
    if (!userState) userState = {};
    userStates.set(chatIdStr, { ...userState, awaitingPinFor: `custom_sell:${tokenId}` });
    await ctx.editMessageText(
      `✏️ *Custom Sell Percentage*\n\nPlease type the percentage (1-100) of your position to sell in the chat:`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Cancel", buildCallbackData("chart", tokenId)) }
    );
    return;
  }

  let token = await getTokenById(tokenId);
  if (!token) {
    await ctx.editMessageText("❌ Token data not found.");
    return;
  }

  const percent = parseInt(percentStr);
  if (isNaN(percent) || percent <= 0 || percent > 100) {
    await ctx.editMessageText("❌ Invalid percentage.");
    return;
  }

  const positionSol = await getUserTokenPosition(String(chatId), token.contractAddress);
  if (positionSol <= 0.000001) {
    await ctx.editMessageText("❌ No position found to sell.");
    return;
  }

  const amountToSell = positionSol * (percent / 100);
  const usdValue = amountToSell * (token.priceUsd || 0);
  const solValueReceived = amountToSell; // Approximated by position SOL amount (not accounting for PnL changes since entry in this UI, but good enough for review)

  const text = `📉 *Review Trade*\n\n` +
    `*Action:* SELL ${percent}%\n` +
    `*Token:* ${token.symbol}\n` +
    `*Exit Price:* ${formatPrice(token.priceUsd ?? 0)}\n` +
    `*Amount:* ${amountToSell.toFixed(4)} SOL tokens sold\n` +
    `*Est. Value Received:* ${solValueReceived.toFixed(4)} SOL (~$${usdValue.toFixed(2)})\n` +
    `*Slippage:* 0.5%\n\n` +
    `🔐 *Enter your PIN in the chat below to execute this trade.*`;

  const keyboard = new InlineKeyboard()
    .text("◀️ Cancel", buildCallbackData("sell", tokenId));

  let userState = userStates.get(chatIdStr) || {};
  userStates.set(chatIdStr, { 
    ...userState, 
    awaitingPinFor: `sell_confirm:${tokenId}:${percent}`,
  });

  await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
}

async function handleSellConfirm(ctx: any, tokenId: string, chatId: string, percentStr: string) {
  let token = await getTokenById(tokenId);
  if (!token) {
    await ctx.editMessageText("❌ Token data not found.");
    return;
  }

  const percent = parseInt(percentStr);
  const chatIdStr = String(chatId);

  // Find open position in database
  const openPosition = await safePrisma.degenHunterPosition.findFirst?.({ where: { chatId: chatIdStr, tokenAddress: token.contractAddress, status: "OPEN" } });

  if (!openPosition) {
    await ctx.editMessageText("❌ No open position found to sell.");
    return;
  }

  const walletRecord = await safePrisma.degenHunterWallet.findUnique?.({ where: { chatId: chatIdStr } });
  if (!walletRecord || !walletRecord.publicKey) {
    await ctx.editMessageText("❌ No burner wallet found.");
    return;
  }

  // The wallet is the source of truth, not the recorded amount (the buy quote's estimate, which can exceed what was
  // delivered: selling "100%" of it asked for tokens that don't exist and failed with SPL error 0x1).
  const holding = await getTokenHolding(rpcEndpoint(), walletRecord.publicKey, token.contractAddress);
  if (!holding.ok) {
    await ctx.editMessageText("❌ Couldn't read the wallet's balance from the chain right now. Nothing was sent. Try again in a moment.");
    return;
  }
  if (holding.raw === 0n) {
    // Sold or moved outside the app: the position is already closed in reality. Fix the record; send nothing.
    await safePrisma.degenHunterPosition.update?.({ where: { id: openPosition.id }, data: { status: "CLOSED", tokenAmount: 0 } });
    await prisma.$executeRawUnsafe(`UPDATE "DegenHunterPosition" SET closedAt = CURRENT_TIMESTAMP WHERE id = ? AND closedAt IS NULL`, openPosition.id).catch(() => {});
    await ctx.editMessageText(`ℹ️ Your wallet no longer holds ${token.symbol}: it was already sold or moved outside the app. I've marked the position closed. Nothing was sent.`);
    return;
  }
  // A failed lookup is "unknown" (null), never 0 — getSolBalance() returns 0 on an RPC error, which would block a sell with a false "no SOL".
  const solBal = await getConnection().getBalance(new PublicKey(walletRecord.publicKey)).then((l) => l / 1e9).catch(() => null);
  if (typeof solBal === "number" && solBal < MIN_SOL_FOR_FEES) {
    await ctx.editMessageText(
      `❌ Not enough SOL for fees: the wallet has ${solBal.toFixed(5)} SOL and a swap needs about ${MIN_SOL_FOR_FEES} SOL on top of the trade.\nDeposit SOL to \`${walletRecord.publicKey}\`.`,
      { parse_mode: "Markdown" }
    );
    return;
  }
  const rawToSell = sellAmountRaw(holding.raw, percent);
  const tokenAmountSmallest = Number(rawToSell);
  const tokenAmountToSell = Number(rawToSell) / Math.pow(10, holding.decimals);
  const heldUi = holding.ui;

  if (tokenAmountSmallest <= 0) {
    await ctx.editMessageText("❌ Position amount too small to sell.");
    return;
  }

  await ctx.editMessageText(`⏳ *Executing Sell...*\n\nSelling ${percent}% of ${token.symbol} position`, { parse_mode: "Markdown" });

  try {
    const { txid, quoteResponse } = await executeJupiterSwap(chatIdStr, token.contractAddress, SOL_MINT, tokenAmountSmallest);

    // Update position: if 100%, mark CLOSED; otherwise reduce amount
    if (percent >= 100) {
      await safePrisma.degenHunterPosition.update?.({ where: { id: openPosition.id }, data: { status: "CLOSED", tokenAmount: 0 } });
    } else {
      const newTokenAmount = Math.max(0, heldUi - tokenAmountToSell);
      await safePrisma.degenHunterPosition.update?.({ where: { id: openPosition.id }, data: { tokenAmount: newTokenAmount } });
    }

    // Realized PnL: record what this sell returned, and on a full close build the
    // trade card. Kept in its own try so a bookkeeping/card problem can never
    // turn a sell that already went through into a "Sell Failed" message.
    let tradeCard: { png: Buffer; transparentPng: Buffer; caption: string } | null = null;
    try {
      await recordSell({
        positionId: openPosition.id,
        solReceived: Number(quoteResponse?.outAmount) / 1e9,
        tokensSold: tokenAmountToSell,
        solUsd: await getSolPriceUsd(),
        closed: percent >= 100,
      });
      if (percent >= 100) {
        const stats = await getClosedTradeStats(openPosition.id);
        if (stats) {
          tradeCard = {
            // The inline photo gets a dark canvas: Telegram flattens photo transparency onto a colour of its own.
            png: await buildTradeCardPng(stats, "dark"),
            // The same card with nothing around it, sent as a file (files keep real transparency) for sharing.
            transparentPng: await buildTradeCardPng(stats, "transparent"),
            caption: tradeCaption(stats),
          };
        }
      }
    } catch (pnlErr) {
      log("degen-hunter-telegram", "warn", `PnL record/card failed for ${token.symbol}: ${(pnlErr as Error).message}`);
    }

    await ctx.api.editMessageText(
      chatIdStr, ctx.callbackQuery?.message?.message_id,
      `*✅ Sell Executed!*\n\n` +
      `Sold: ${percent}% of ${token.symbol} position\n` +
      `Price: ${formatPrice(token.priceUsd ?? 0)}\n\n` +
      `*TX:* \`${txid}\`\n` +
      `https://solscan.io/tx/${txid}`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Back to Token", buildCallbackData("chart", tokenId)) }
    );

    // The closed-trade card: X, %, entry → exit, SOL in/out.
    if (tradeCard) {
      await ctx.api
        .sendPhoto(chatIdStr, new InputFile(tradeCard.png, `${token.symbol}-trade.png`), { caption: tradeCard.caption })
        .catch((e: Error) => log("degen-hunter-telegram", "warn", `Could not send trade card: ${e.message}`));
      // The transparent version, as a file so Telegram keeps its alpha channel (silent: it's the same trade, just for sharing).
      await ctx.api
        .sendDocument(chatIdStr, new InputFile(tradeCard.transparentPng, `${token.symbol}-trade-transparent.png`), {
          caption: "Same card, no background (transparent PNG) — for sharing.",
          disable_notification: true,
        })
        .catch((e: Error) => log("degen-hunter-telegram", "warn", `Could not send transparent trade card: ${e.message}`));
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    await ctx.api.editMessageText(
      chatIdStr, ctx.callbackQuery?.message?.message_id,
      `❌ *Sell Failed*\n\nError: ${msg.substring(0, 200)}`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("◀️ Back to Token", buildCallbackData("chart", tokenId)) }
    );
  }
}

async function handleMuteButton(ctx: any, tokenId: string, chatId: string) {
  // Get token from recent tokens storage
  let token = recentTokens.get(tokenId);

  // If not in memory, try to fetch from database
  if (!token) {
    const storedToken = await safePrisma.degenHunterRecentToken.findUnique?.({ where: { tokenId: tokenId } });
    if (storedToken && storedToken.tokenData) {
      try {
        token = JSON.parse(storedToken.tokenData) as DegenToken;
        // Cache it in memory for faster access
        recentTokens.set(tokenId, token);
      } catch (error) {
        console.error("[degen-hunter-telegram] Error parsing token data:", error);
      }
    }
  }

  if (!token) {
    await ctx.editMessageText("❌ Token data not found. The token may be too old.");
    return;
  }

  const chatIdStr = String(chatId);

  // Add to muted tokens
  await safePrisma.degenHunterMutedToken.upsert({
    where: { chatId_tokenAddress: { chatId: chatIdStr, tokenAddress: token.contractAddress } },
    update: { mutedAt: new Date() },
    create: {
      chatId: chatIdStr,
      tokenAddress: token.contractAddress,
      mutedAt: new Date(),
    },
  });

  // Add to in-memory set
  mutedTokens.add(`${chatIdStr}:${token.contractAddress}`);

  await ctx.editMessageText(
    `*🔇 Alerts Muted*\n\n` +
    `Alerts for ${token.symbol} have been muted.\n\n` +
    `You will no longer receive alerts for this token.\n\n` +
    `Use /unmute <tokenAddress> to restore alerts.`,
    { parse_mode: "Markdown" }
  );
}

// Helper functions
async function getTokenById(tokenId: string): Promise<DegenToken | null> {
  // First check in-memory cache
  const token = recentTokens.get(tokenId);
  if (token) {
    return token;
  }

  // If not in memory, try to fetch from database
  const storedToken = await safePrisma.degenHunterRecentToken.findUnique?.({ where: { tokenId: tokenId } });
  if (storedToken && storedToken.tokenData) {
    try {
      const parsedToken = JSON.parse(storedToken.tokenData);
      // Cache it in memory for faster access
      recentTokens.set(tokenId, parsedToken);
      return parsedToken;
    } catch (error) {
      console.error("[degen-hunter-telegram] Error parsing token data:", error);
      return null;
    }
  }

  return null;
}

/**
 * Risk, as shown in alerts: one assessment (assessRisk, @max/shared) gives the
 * level AND the reasons, so they always agree. This replaces a mapping from the
 * *opportunity* score, which labelled a high-opportunity token "🔴 High" risk
 * with no flags to back it up.
 */
const RISK_LABEL = { low: "🟢 Low", medium: "🟡 Medium", high: "🔴 High", critical: "⛔ Critical" } as const;

function riskSummary(token: DegenToken) {
  const a = assessRisk(token);
  const level = `${RISK_LABEL[a.level]}${a.level === "low" && a.limitedChecks ? " (limited checks)" : ""}`;
  return {
    level,
    flags: a.riskFlags.length ? a.riskFlags.join(", ") : "None found",
    warnings: a.warnings,
    evidence: a.evidence,
    // What couldn't be checked: "no flag" on these means unknown, not fine.
    unverified: a.unverified.length ? a.unverified.join(", ") : "",
  };
}

/** The action buttons on a token card. Shared by private-chat alerts and the /start d_<id> deep link, so both look and behave the same. */
function alertKeyboard(token: DegenToken) {
  return InlineKeyboard.from([
    [
      { text: "📊 Chart", callback_data: buildCallbackData("chart", token.id) },
      { text: "📋 Details", callback_data: buildCallbackData("details", token.id) },
    ],
    [
      { text: "👁️ Watch", callback_data: buildCallbackData("watch", token.id) },
      { text: "🚫 Ignore", callback_data: buildCallbackData("ignore", token.id) },
    ],
    [
      { text: "💰 Buy", callback_data: buildCallbackData("buy", token.id) },
      { text: "🔇 Mute", callback_data: buildCallbackData("mute", token.id) },
    ]
  ]);
}

/**
 * Sends a watchlist performance alert (an X milestone, a drop, or a rug).
 * Goes to the alerts channel when DEGEN_ALERTS_CHAT_ID is set, otherwise the
 * owner's private chat. Link button only, for the same reason as token
 * alerts: callback buttons in a channel can't tell whose wallet is acting.
 */
export async function sendWatchlistAlert(ownerChatId: string, text: string, chartUrl?: string): Promise<void> {
  if (!bot) startBot();
  if (!bot) throw new Error("Degen Hunter bot is not available");
  const target = process.env.DEGEN_ALERTS_CHAT_ID?.trim() || ownerChatId;
  await bot.api.sendMessage(target, text, {
    reply_markup: chartUrl ? new InlineKeyboard().url("📊 Chart", chartUrl) : undefined,
    link_preview_options: { is_disabled: true },
  });
}

/**
 * Records the price a token had when it went on the watchlist — the "1×" that
 * later multiples are measured against. Only fills a missing baseline, so
 * re-watching never resets an existing one. Raw SQL: the column was added
 * after the Prisma client was generated (see lib/watchlistMonitor.ts).
 */
async function setWatchBaseline(chatId: string, tokenAddress: string, priceUsd?: number) {
  if (!(typeof priceUsd === "number" && priceUsd > 0)) return;
  await prisma
    .$executeRawUnsafe(
      `UPDATE "DegenHunterWatchlist" SET baselinePriceUsd = ? WHERE chatId = ? AND tokenAddress = ? AND baselinePriceUsd IS NULL`,
      priceUsd, chatId, tokenAddress
    )
    .catch(() => {});
}

// Function to send token alerts (to be called from the agent)
export async function sendTokenAlert(token: DegenToken): Promise<void> {
  if (!bot) {
    log("degen-hunter-telegram", "warn", "Bot not initialized, cannot send alert");
    return;
  }

  // Store the token for later retrieval by button handlers
  storeTokenForTelegram(token);

  const chatIdStr = token.contractAddress; // Using token address as key for cooldown
  const now = Date.now();

  // Check cooldown
  const lastAlertTime = alertCooldowns.get(chatIdStr) || 0;
  if (now - lastAlertTime < ALERT_COOLDOWN_MS) {
    log("degen-hunter-telegram", "info", `Alert cooldown active for ${token.symbol}`);
    return;
  }

  // Check if token is muted (we'd need to check all users, simplified for now)
  // In a full implementation, we'd check per-user mute lists

  // Generate alert message (reuse existing function but enhance for Telegram)
  // Can Jupiter route a buy right now? Brand-new tokens often can't yet, and the
  // owner would otherwise only find out after going through the buy flow.
  const route = await checkTradable(token.contractAddress, 10_000_000); // probe with 0.01 SOL
  const tradableLine = route.tradable
    ? "✅ Tradable on Jupiter"
    : "⏳ Not tradable on Jupiter yet — a buy will fail until it's indexed (usually a few minutes)";
  const alertMessage = `${generateEnhancedTokenAlert(token)}\n\n${tradableLine}`;

  // Create inline keyboard
  const keyboard = alertKeyboard(token);

  // Fetch all users who have alerts enabled
  const users = await safePrisma.degenHunterUser.findMany({
    where: { alertsEnabled: true }
  });

  if (!users || users.length === 0) {
    return;
  }

  // Separate alerts channel/group: when DEGEN_ALERTS_CHAT_ID is set, token
  // alerts go there once and the private chat stays reserved for the wallet
  // (balance, PIN, buy/sell, withdraw). Only URL buttons are attached — every
  // wallet/trade callback handler resolves *whose wallet* from ctx.chat.id,
  // which in a channel/group would be the channel's id, not the owner's, so
  // callback buttons (Buy/Watch/Ignore/Mute) must not be posted there.
  const alertsChatId = process.env.DEGEN_ALERTS_CHAT_ID?.trim();
  if (alertsChatId) {
    const anyoneWants = users.some((u) => !mutedTokens.has(`${u.chatId}:${token.contractAddress}`));
    if (anyoneWants) {
      const botUsername = process.env.DEGEN_BOT_USERNAME?.replace(/^@/, "");
      const urlRow: { text: string; url: string }[] = [
        { text: "📊 Chart", url: token.dexUrl || `https://dexscreener.com/solana/${token.contractAddress}` },
      ];
      // Deep link: opens the bot on *this token's* card, not just the bot's chat.
      if (botUsername) urlRow.push({ text: "💰 Open in bot", url: `https://t.me/${botUsername}?start=d_${getShortId(token.id)}` });
      try {
        await bot.api.sendMessage(alertsChatId, alertMessage, {
          reply_markup: InlineKeyboard.from([urlRow]),
          parse_mode: "Markdown",
          link_preview_options: { is_disabled: true },
        });
        alertCooldowns.set(chatIdStr, now);
        // Success used to be silent, so "Sent N alerts" in the activity feed
        // couldn't be told apart from a send that quietly didn't happen.
        log("degen-hunter-telegram", "info", `Posted alert to alerts channel: ${token.symbol}`);
        return;
      } catch (err) {
        // Don't fall through to DMs: that would silently re-create the stacked
        // chat this setting exists to avoid. Surface it and keep the cooldown unset so the next scan retries.
        log("degen-hunter-telegram", "error", `Failed to send alert to DEGEN_ALERTS_CHAT_ID (is the bot an admin of that channel/group?): ${(err as Error).message}`);
        return;
      }
    }
  }

  // Broadcast to all active users
  for (const user of users) {
    // Check if token is muted for this specific user
    const isMuted = mutedTokens.has(`${user.chatId}:${token.contractAddress}`);
    if (isMuted) continue;

    try {
      await bot.api.sendMessage(user.chatId, alertMessage, { 
        reply_markup: keyboard, 
        parse_mode: "Markdown",
        link_preview_options: { is_disabled: true }
      });
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (err) {
      log("degen-hunter-telegram", "error", `Failed to send alert to ${user.chatId}: ${(err as Error).message}`);
    }
  }

  // Update cooldown after successful broadcast
  alertCooldowns.set(chatIdStr, now);
}

function generateEnhancedTokenAlert(token: DegenToken): string {
  const risk = riskSummary(token);
  const ageMinutes = token.tokenAgeMinutes ?? 0;
  const ageDisplay = ageMinutes < 60
    ? `${ageMinutes} min`
    : `${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}min`;

  return [
    `🔥 *DEGEN HUNTER ALERT* 🔥\n`,
    `*${token.name}* ($${token.symbol})\n`,
    `🔗 Solana | ${ageDisplay}\n`,
    `💰 Price: ${formatPrice(token.priceUsd)}\n`,
    `📊 Market Cap: $${token.marketCapUsd?.toLocaleString() || "?"}\n`,
    `📈 FDV: $${token.fdvUsd?.toLocaleString() || "?"}\n`,
    `💧 Liquidity: $${token.liquidityUsd?.toLocaleString() || "?"}\n`,
    `📉 Volume 24h: $${token.volume24hUsd?.toLocaleString() || "?"}\n`,
    `📈 Buys 24h: ${token.buys24h?.toLocaleString() || "?"}\n`,
    `📉 Sells 24h: ${token.sells24h?.toLocaleString() || "?"}\n`,
    `🎯 Opportunity Score: ${token.totalScore || "?"}/100\n`,
    `⚠️ Risk Level: ${risk.level}\n`,
    `🏷️ Risk Flags: ${risk.flags}\n`,
    // Every elevated level has at least one warning here (the level is derived from the flags).
    risk.warnings.length ? `⚠️ Why: ${risk.warnings.slice(0, 4).map((w) => `• ${w}`).join("\n")}\n` : "",
    risk.unverified ? `ℹ️ Not verified: ${risk.unverified}\n` : "",
    `🔗 [View on DexScreener](${token.dexUrl || `https://dexscreener.com/solana/${token.contractAddress}`})\n`,
    `_Contract: \`${token.contractAddress}\`_`,
  ].filter(Boolean).join("\n");
}

// Initialize database tables if they don't exist
