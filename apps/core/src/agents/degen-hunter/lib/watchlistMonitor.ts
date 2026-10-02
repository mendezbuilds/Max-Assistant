import { prisma, filterUnseen, markSeen } from "@max/db";
import { assessRisk, type RiskLevel } from "@max/shared";
import { log } from "../../../logger";
import { fetchWithRetry } from "../../../lib/http";
import { publishAlert } from "../../../lib/notifications";
import { sendWatchlistAlert } from "../telegram/bot";
import { reconcileAllPositions } from "./reconcile";

/**
 * Tracks every token the owner is following — watchlist tokens AND open positions —
 * and sends a TRACKING UPDATE when one hits a new "X" (how many times its price has
 * multiplied since it was added/bought), drops by half, or gets rugged. These are the
 * only alerts that become dashboard toast popups.
 *
 * A change in a tracked token's RISK is not its own alert type: it is folded into the
 * tracking update ("… Risk escalated to HIGH: <why>"). If the risk rises while no price
 * milestone is firing, it goes out as a tracking update too — never as a separate
 * risk-specific notification.
 *
 * Watchlist state (baseline price, which X milestones fired, drop/rug) lives in the DB,
 * so a restart never repeats an alert. Position milestones are deduplicated through the
 * shared SeenItem table. Risk escalation is compared against the last risk seen in this
 * process: the first sighting after a restart only sets the baseline, silently.
 *
 * The watchlist tracking columns were added by a migration after the Prisma client was
 * last generated, so they're read and written with raw SQL.
 */

/** Price multiples that trigger an alert, each once. */
export const X_LEVELS = [1.5, 2, 3, 5, 10, 20, 50, 100];
/** "Down 50%" warning. */
export const DROP_MULTIPLE = 0.5;
/** Price at or below this fraction of baseline counts as rugged on its own… */
export const RUG_MULTIPLE = 0.1;
/** …and so does liquidity below this (USD) once the price is also down at least half — a pulled pool. */
export const RUG_LIQUIDITY_USD = 500;

export interface WatchRow {
  id: number;
  chatId: string;
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  baselinePriceUsd: number | null;
  xAlertLevel: number;
  dropAlerted: number | boolean;
  ruggedAt: string | null;
}

export type WatchAction =
  | { type: "baseline"; price: number }
  | { type: "x"; level: number; multiple: number }
  | { type: "drop"; multiple: number }
  | { type: "rug"; multiple: number; reason: string };

/**
 * Pure decision logic: given a row and the token's current price/liquidity,
 * which alerts (if any) should fire. Kept free of I/O so it can be tested.
 */
export function evaluateWatch(row: WatchRow, priceUsd: number, liquidityUsd: number): { multiple: number | null; actions: WatchAction[] } {
  if (!(priceUsd > 0)) return { multiple: null, actions: [] };
  if (!row.baselinePriceUsd || row.baselinePriceUsd <= 0) {
    return { multiple: 1, actions: [{ type: "baseline", price: priceUsd }] };
  }

  const multiple = priceUsd / row.baselinePriceUsd;

  const priceCollapsed = multiple <= RUG_MULTIPLE;
  const poolPulled = liquidityUsd < RUG_LIQUIDITY_USD && multiple <= DROP_MULTIPLE;
  if (priceCollapsed || poolPulled) {
    return {
      multiple,
      actions: [{
        type: "rug",
        multiple,
        reason: poolPulled ? `liquidity is down to $${Math.round(liquidityUsd)}` : `price is down ${Math.round((1 - multiple) * 100)}%`,
      }],
    };
  }

  const actions: WatchAction[] = [];
  const reached = X_LEVELS.filter((l) => multiple >= l).length;
  if (reached > row.xAlertLevel) actions.push({ type: "x", level: reached, multiple });
  if (multiple <= DROP_MULTIPLE && !row.dropAlerted) actions.push({ type: "drop", multiple });
  return { multiple, actions };
}

interface Market {
  price: number;
  liquidity: number;
  url?: string;
  marketCap?: number;
  volume24h?: number;
  buys24h?: number;
  sells24h?: number;
  priceChange1h?: number;
}

interface DexPair {
  baseToken?: { address?: string; symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  volume?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  priceChange?: { h1?: number };
  url?: string;
}

function fmtPrice(n: number): string {
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  if (n < 1) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(2)}`;
}

/** Current market data for each address from DexScreener (best-liquidity pair per token), 30 addresses per request. */
async function fetchMarket(addresses: string[]): Promise<Map<string, Market>> {
  const out = new Map<string, Market>();
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    const res = await fetchWithRetry(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`, { timeoutMs: 15000, retries: 2 });
    if (!res.ok) throw new Error(`DexScreener responded ${res.status}`);
    const pairs = (await res.json()) as DexPair[];
    for (const p of Array.isArray(pairs) ? pairs : []) {
      const addr = p.baseToken?.address;
      const price = Number(p.priceUsd);
      if (!addr || !(price > 0)) continue;
      const liquidity = p.liquidity?.usd ?? 0;
      const best = out.get(addr);
      if (!best || liquidity > best.liquidity) {
        out.set(addr, {
          price,
          liquidity,
          url: p.url,
          marketCap: p.marketCap ?? p.fdv,
          volume24h: p.volume?.h24,
          buys24h: p.txns?.h24?.buys,
          sells24h: p.txns?.h24?.sells,
          priceChange1h: p.priceChange?.h1,
        });
      }
    }
  }
  return out;
}

// ─── Risk, folded into tracking updates ──────────────────────────────────────

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
/** Last risk level seen per tracked token, in this process. The first sighting only sets the baseline. */
const lastRisk = new Map<string, RiskLevel>();

/**
 * The token's current risk, assessed from the on-chain data stored when it was
 * discovered (authorities, holders) plus today's market data. If it has risen since the
 * last time we looked, returns the line to fold into that token's tracking update.
 */
async function riskEscalation(address: string, m: Market): Promise<{ level: RiskLevel; note: string; short: string } | null> {
  const row = await prisma.degenHunterRecentToken.findFirst({ where: { tokenData: { contains: address } }, orderBy: { updatedAt: "desc" } });
  let stored: Record<string, unknown> = {};
  try {
    stored = row ? JSON.parse(row.tokenData) : {};
  } catch { /* assess from market data alone */ }

  const a = assessRisk({
    ...(stored as object),
    marketCapUsd: m.marketCap ?? (stored.marketCapUsd as number | undefined),
    liquidityUsd: m.liquidity || (stored.liquidityUsd as number | undefined),
    volume24hUsd: m.volume24h ?? (stored.volume24hUsd as number | undefined),
    buys24h: m.buys24h ?? (stored.buys24h as number | undefined),
    sells24h: m.sells24h ?? (stored.sells24h as number | undefined),
    priceChange1h: m.priceChange1h,
  });

  const before = lastRisk.get(address);
  lastRisk.set(address, a.level);
  if (before === undefined || RISK_RANK[a.level] <= RISK_RANK[before]) return null;
  return {
    level: a.level,
    note: `⚠ Risk escalated to ${a.level.toUpperCase()}${a.warnings[0] ? `: ${a.warnings[0]}` : ""}`,
    // The toast carries just this short phrase; the full reason is in the Telegram message.
    short: `⚠ Risk escalated to ${a.level.toUpperCase()}`,
  };
}

/** Publishes one tracking update: the activity feed first (this is what becomes the dashboard toast), then Telegram. */
async function emit(opts: { type: string; text: string; level: "info" | "warn"; chatId: string; tokenAddress: string; chart: string; multiple?: number; name: string; riskShort?: string }) {
  // The toast shows the activity-feed message, which is only the FIRST line of the alert — so a folded-in risk
  // escalation has to be added to that line explicitly, or it would reach Telegram but never the toast.
  const toastMessage = `${opts.text.split("\n")[0]}${opts.riskShort ? ` · ${opts.riskShort}` : ""}`;
  await publishAlert("degen-hunter", opts.type, toastMessage, opts.level, { tokenAddress: opts.tokenAddress, multiple: opts.multiple }).catch(() => {});
  await sendWatchlistAlert(opts.chatId, opts.text, opts.chart).catch((err) =>
    log("degen-hunter-telegram", "error", `Failed to send tracking update for ${opts.name}: ${(err as Error).message}`)
  );
}

// ─── The tracker ─────────────────────────────────────────────────────────────

export async function checkTracked(): Promise<void> {
  // First, make the open positions match what the wallet really holds (a position sold elsewhere must not keep alerting as open).
  await reconcileAllPositions().catch((e) => log("degen-hunter", "warn", `Position reconcile failed: ${(e as Error).message}`));

  const raw = await prisma.$queryRawUnsafe<WatchRow[]>(
    `SELECT id, chatId, tokenAddress, tokenSymbol, tokenName, baselinePriceUsd, xAlertLevel, dropAlerted, ruggedAt
       FROM "DegenHunterWatchlist" WHERE ruggedAt IS NULL`
  );
  // Raw SQLite integers can come back as bigint; normalize before doing any arithmetic on them.
  const rows: WatchRow[] = raw.map((r) => ({
    ...r,
    id: Number(r.id),
    baselinePriceUsd: r.baselinePriceUsd == null ? null : Number(r.baselinePriceUsd),
    xAlertLevel: Number(r.xAlertLevel ?? 0),
    dropAlerted: Number(r.dropAlerted ?? 0) !== 0,
  }));
  const positions = await prisma.degenHunterPosition.findMany({ where: { status: "OPEN" } });
  if (rows.length === 0 && positions.length === 0) return;

  const heldAddresses = new Set(positions.map((p) => p.tokenAddress));
  const market = await fetchMarket([...new Set([...rows.map((r) => r.tokenAddress), ...positions.map((p) => p.tokenAddress)])]);

  // ── Watchlist tokens ──
  for (const row of rows) {
    if (heldAddresses.has(row.tokenAddress)) continue; // a held token is tracked as a position below, not twice
    const m = market.get(row.tokenAddress);
    if (!m) continue; // no market data right now — unknown, not "rugged"
    const { multiple, actions } = evaluateWatch(row, m.price, m.liquidity);
    const name = row.tokenSymbol ? `$${row.tokenSymbol}` : row.tokenName ?? `${row.tokenAddress.slice(0, 6)}…`;
    const chart = m.url ?? `https://dexscreener.com/solana/${row.tokenAddress}`;
    const baseline = row.baselinePriceUsd ?? m.price;

    if (multiple != null) {
      await prisma.$executeRawUnsafe(`UPDATE "DegenHunterWatchlist" SET lastMultiple = ? WHERE id = ?`, multiple, row.id);
    }

    const esc = await riskEscalation(row.tokenAddress, m);
    let escUsed = false;
    const real = actions.filter((a) => a.type !== "baseline");

    for (const a of actions) {
      if (a.type === "baseline") {
        await prisma.$executeRawUnsafe(`UPDATE "DegenHunterWatchlist" SET baselinePriceUsd = ?, lastMultiple = 1 WHERE id = ?`, a.price, row.id);
        continue;
      }

      let text: string;
      let type: string;
      if (a.type === "x") {
        type = "watchlist-x";
        text =
          `📈 ${name} is now ${a.multiple.toFixed(a.multiple >= 10 ? 0 : 1)}× since you added it\n` +
          `${fmtPrice(baseline)} → ${fmtPrice(m.price)}  ·  liquidity $${Math.round(m.liquidity).toLocaleString()}`;
        await prisma.$executeRawUnsafe(`UPDATE "DegenHunterWatchlist" SET xAlertLevel = ? WHERE id = ?`, a.level, row.id);
      } else if (a.type === "drop") {
        type = "watchlist-drop";
        text =
          `📉 ${name} is down ${Math.round((1 - a.multiple) * 100)}% since you added it\n` +
          `${fmtPrice(baseline)} → ${fmtPrice(m.price)}  ·  liquidity $${Math.round(m.liquidity).toLocaleString()}`;
        await prisma.$executeRawUnsafe(`UPDATE "DegenHunterWatchlist" SET dropAlerted = 1 WHERE id = ?`, row.id);
      } else {
        type = "watchlist-rug";
        text =
          `☠️ ${name} looks RUGGED — ${a.reason}\n` +
          `${fmtPrice(baseline)} → ${fmtPrice(m.price)}  ·  liquidity $${Math.round(m.liquidity).toLocaleString()}\n` +
          `I've stopped tracking it.`;
        await prisma.$executeRawUnsafe(`UPDATE "DegenHunterWatchlist" SET ruggedAt = CURRENT_TIMESTAMP WHERE id = ?`, row.id);
      }
      const foldRisk = !!esc && !escUsed;
      if (esc && !escUsed) { text += `\n${esc.note}`; escUsed = true; } // folded in, not a separate alert

      await emit({ type, text, level: a.type === "x" ? "info" : "warn", chatId: row.chatId, tokenAddress: row.tokenAddress, chart, multiple: a.multiple, name, riskShort: foldRisk ? esc?.short : undefined });
    }

    // Risk rose with no price milestone firing: still one tracking update for this token, never a risk-only alert.
    if (esc && !escUsed && real.length === 0) {
      const m1 = multiple ?? 1;
      await emit({
        type: "tracking-update",
        text: `👁 ${name} tracking update: ${m1.toFixed(2)}× since you added it\n${esc.note}`,
        level: "warn", chatId: row.chatId, tokenAddress: row.tokenAddress, chart, multiple: m1, name, riskShort: esc.short,
      });
    }
  }

  // ── Open positions: the same milestones, measured from your entry price ──
  for (const p of positions) {
    const m = market.get(p.tokenAddress);
    const entry = Number(p.entryPriceUsd);
    if (!m || !(entry > 0)) continue;
    const multiple = m.price / entry;
    const name = p.tokenSymbol ? `$${p.tokenSymbol}` : `${p.tokenAddress.slice(0, 6)}…`;
    const chart = m.url ?? `https://dexscreener.com/solana/${p.tokenAddress}`;
    const line = `${fmtPrice(entry)} → ${fmtPrice(m.price)}  ·  liquidity $${Math.round(m.liquidity).toLocaleString()}`;
    const esc = await riskEscalation(p.tokenAddress, m);
    let sent = false;
    const send = async (id: string, type: string, text: string, level: "info" | "warn") => {
      const unseen = await filterUnseen("degen-hunter", [id]);
      if (unseen.length === 0) return false;
      await markSeen("degen-hunter", [id]);
      await emit({ type, text: esc && !sent ? `${text}\n${esc.note}` : text, level, chatId: p.chatId, tokenAddress: p.tokenAddress, chart, multiple, name, riskShort: esc && !sent ? esc.short : undefined });
      sent = true;
      return true;
    };

    const rugged = multiple <= RUG_MULTIPLE || (m.liquidity < RUG_LIQUIDITY_USD && multiple <= DROP_MULTIPLE);
    if (rugged) {
      const why = m.liquidity < RUG_LIQUIDITY_USD && multiple > RUG_MULTIPLE ? `liquidity is down to $${Math.round(m.liquidity)}` : `price is down ${Math.round((1 - multiple) * 100)}%`;
      await send(`pos-rug:${p.id}`, "position-rug", `☠️ ${name} (your position) looks RUGGED — ${why}\n${line}`, "warn");
    } else {
      const reached = X_LEVELS.filter((l) => multiple >= l).length;
      if (reached > 0) {
        // One alert for the highest level reached (a jump to 12× is one alert, not four); lower levels are marked seen.
        const ids = Array.from({ length: reached }, (_, i) => `pos-x:${p.id}:${i + 1}`);
        const unseen = await filterUnseen("degen-hunter", [ids[reached - 1]]);
        if (unseen.length > 0) {
          await markSeen("degen-hunter", ids);
          await emit({
            type: "position-x",
            text: `📈 ${name} is now ${multiple.toFixed(multiple >= 10 ? 0 : 1)}× since you bought it\n${line}${esc ? `\n${esc.note}` : ""}`,
            level: "info", chatId: p.chatId, tokenAddress: p.tokenAddress, chart, multiple, name, riskShort: esc?.short,
          });
          sent = true;
        }
      }
      if (multiple <= DROP_MULTIPLE) {
        await send(`pos-drop:${p.id}`, "position-drop", `📉 ${name} (your position) is down ${Math.round((1 - multiple) * 100)}% since you bought it\n${line}`, "warn");
      }
    }

    if (esc && !sent) {
      await emit({
        type: "tracking-update",
        text: `👁 ${name} tracking update: ${multiple.toFixed(2)}× since you bought it\n${esc.note}`,
        level: "warn", chatId: p.chatId, tokenAddress: p.tokenAddress, chart, multiple, name, riskShort: esc.short,
      });
    }
  }
}

/** Kept under its old name: runDegenHunter and the tests still call it. */
export const checkWatchlist = checkTracked;
