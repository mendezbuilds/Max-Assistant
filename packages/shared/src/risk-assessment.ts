/**
 * The one place a token's risk is decided.
 *
 * Why this exists: risk used to be two unrelated things that could disagree. A
 * "Risk Level" label was computed from the *opportunity* score (so a high-opportunity
 * token read "🔴 High risk"), while "Risk Flags"/"Warnings" came from a short list of
 * on-chain checks — leaving "High risk, no flags, no warnings" on screen with nothing
 * to explain it. Here the level is DERIVED FROM the flags and nothing else, so:
 *
 *   - every Medium-or-above level has at least one flag explaining it, by construction;
 *   - Telegram, the dashboard and the stored token can't disagree, because they all
 *     call this with the same data.
 *
 * Pure (data in, assessment out; no I/O), so the bot, the scanner and the dashboard
 * can all import it, and old stored tokens can be re-assessed on the fly.
 */

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type FlagTier = "critical" | "high" | "medium" | "info";

/** The token fields the assessment reads. Everything optional: records come from different scanner versions. */
export interface RiskInput {
  marketCapUsd?: number;
  fdvUsd?: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
  buys24h?: number;
  sells24h?: number;
  priceChange1h?: number;
  tokenAgeMinutes?: number;
  mintAuthorityActive?: boolean;
  freezeAuthorityActive?: boolean;
  topHolderConcentration?: number;
  liquidityLocked?: boolean;
  honeypotStatus?: string;
  buyTaxPercent?: number;
  sellTaxPercent?: number;
}

export interface RiskFlag {
  id: string;
  tier: FlagTier;
  /** Plain-English reason, with the actual numbers. */
  warning: string;
  /** Where it came from / what was measured. */
  evidence: string;
}

export interface RiskAssessment {
  level: RiskLevel;
  /** Every flag that was raised, worst first. */
  flags: RiskFlag[];
  /** Convenience arrays in the shape the token records already use. */
  riskFlags: string[];
  warnings: string[];
  evidence: string[];
  /** Checks that could NOT be run, so "no flag" there means "unknown", not "fine". */
  unverified: string[];
  /** True when key on-chain checks (authorities, holders) are missing — a "Low" is then a weak statement. */
  limitedChecks: boolean;
}

const TIER_ORDER: Record<FlagTier, number> = { critical: 0, high: 1, medium: 2, info: 3 };

const usd = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(0)}`);

export function assessRisk(t: RiskInput): RiskAssessment {
  const flags: RiskFlag[] = [];
  const flag = (id: string, tier: FlagTier, warning: string, evidence: string) => flags.push({ id, tier, warning, evidence });

  // ── On-chain / contract signals ─────────────────────────────────────────────
  if (t.honeypotStatus === "honeypot-risk" || (t.sellTaxPercent ?? 0) > 50) {
    flag("honeypot-risk", "critical", "Honeypot indicators: selling may be blocked or taxed away", "Buy/sell tax analysis");
  } else if (t.honeypotStatus === "suspicious") {
    flag("honeypot-suspicious", "medium", "Suspicious buy/sell taxes", "Buy/sell tax analysis");
  }
  if ((t.buyTaxPercent ?? 0) > 10 || (t.sellTaxPercent ?? 0) > 10) {
    flag("tax-risk", "high", `High tax: buy ${t.buyTaxPercent ?? 0}% / sell ${t.sellTaxPercent ?? 0}%`, "Buy/sell tax analysis");
  }
  if (t.mintAuthorityActive === true) {
    flag("mint-authority-active", "high", "Mint authority is still active: the creator can create unlimited new supply", "Solana RPC: mint authority present");
  }
  if (t.freezeAuthorityActive === true) {
    flag("freeze-authority-active", "high", "Freeze authority is still active: the creator can freeze holders' tokens", "Solana RPC: freeze authority present");
  }
  if (t.topHolderConcentration !== undefined) {
    if (t.topHolderConcentration > 50) {
      flag("high-holder-concentration", "high", `Top 10 holders control ${t.topHolderConcentration.toFixed(0)}% of supply`, "Solana RPC: largest token accounts");
    } else if (t.topHolderConcentration > 30) {
      flag("moderate-holder-concentration", "medium", `Top 10 holders control ${t.topHolderConcentration.toFixed(0)}% of supply`, "Solana RPC: largest token accounts");
    }
  }
  if (t.liquidityLocked === false) {
    flag("liquidity-unlocked", "medium", "Liquidity is not locked", "Liquidity lock check");
  }

  // ── Market-behaviour signals (from DexScreener data) ────────────────────────
  const mcap = t.marketCapUsd ?? t.fdvUsd;
  const vol = t.volume24hUsd;
  const buys = t.buys24h ?? 0;
  const sells = t.sells24h ?? 0;
  const trades = buys + sells;
  const volToMcap = mcap && mcap > 0 && vol !== undefined ? vol / mcap : undefined;
  const buySellRatio = sells > 0 ? buys / sells : undefined;

  if (volToMcap !== undefined) {
    if (volToMcap >= 5) {
      flag(
        "extreme-volume-vs-mcap",
        "high",
        `24h volume is ${volToMcap.toFixed(1)}× the market cap (${usd(vol!)} vs ${usd(mcap!)}): the same money is being turned over repeatedly`,
        "DexScreener: volume24h ÷ marketCap"
      );
    } else if (volToMcap >= 2.5) {
      flag("elevated-volume-vs-mcap", "medium", `24h volume is ${volToMcap.toFixed(1)}× the market cap (${usd(vol!)} vs ${usd(mcap!)})`, "DexScreener: volume24h ÷ marketCap");
    }
  }
  // Wash-trading pattern: lots of volume relative to size AND buys ≈ sells over a high trade count. Balanced
  // trading is normal for a healthy market, so it only counts alongside the volume signal; the evidence gives
  // the exact numbers so the reader can judge.
  if (volToMcap !== undefined && volToMcap >= 2.5 && trades >= 500 && buySellRatio !== undefined && buySellRatio >= 0.8 && buySellRatio <= 1.25) {
    flag(
      "possible-wash-trading",
      "high",
      `Possible wash trading: ${buys.toLocaleString()} buys vs ${sells.toLocaleString()} sells (almost 1:1) alongside ${volToMcap.toFixed(1)}× volume-to-market-cap`,
      "DexScreener: buys24h / sells24h with volume24h ÷ marketCap"
    );
  }
  if (t.liquidityUsd !== undefined && t.liquidityUsd > 0) {
    if (t.liquidityUsd < 5000) {
      flag("thin-liquidity", "high", `Very thin liquidity (${usd(t.liquidityUsd)}): easy to move, hard to exit`, "DexScreener: liquidity.usd");
    } else if (t.liquidityUsd < 15000) {
      flag("low-liquidity", "medium", `Low liquidity (${usd(t.liquidityUsd)})`, "DexScreener: liquidity.usd");
    }
  }
  if (buySellRatio !== undefined && trades >= 200 && sells / Math.max(buys, 1) > 1.5) {
    flag("sell-pressure", "medium", `Heavy selling: ${sells.toLocaleString()} sells vs ${buys.toLocaleString()} buys`, "DexScreener: buys24h / sells24h");
  }
  if (t.priceChange1h !== undefined && t.priceChange1h <= -40) {
    flag("price-dumping", "medium", `Price is down ${Math.abs(t.priceChange1h).toFixed(0)}% in the last hour`, "DexScreener: priceChange.h1");
  }
  if (t.tokenAgeMinutes !== undefined && t.tokenAgeMinutes < 10) {
    flag("very-new-token", "info", `Only ${Math.max(0, Math.round(t.tokenAgeMinutes))} minutes old: very little history to judge`, "Pair creation time");
  }

  // ── The level: derived from the flags, nothing else ─────────────────────────
  flags.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  const count = (tier: FlagTier) => flags.filter((f) => f.tier === tier).length;
  let level: RiskLevel;
  if (count("critical") >= 1 || count("high") >= 3) level = "critical";
  else if (count("high") >= 1) level = "high";
  else if (count("medium") >= 1) level = "medium";
  else level = "low";

  // ── What we couldn't check ──────────────────────────────────────────────────
  const unverified: string[] = [];
  if (t.mintAuthorityActive === undefined || t.freezeAuthorityActive === undefined) unverified.push("mint/freeze authority");
  if (t.topHolderConcentration === undefined) unverified.push("holder concentration");
  if (t.liquidityLocked === undefined) unverified.push("liquidity lock");
  if (t.honeypotStatus === undefined || t.honeypotStatus === "unknown") unverified.push("honeypot / taxes");
  if (!t.liquidityUsd || t.liquidityUsd <= 0) unverified.push("liquidity");

  return {
    level,
    flags,
    riskFlags: flags.map((f) => f.id),
    warnings: flags.map((f) => f.warning),
    evidence: flags.map((f) => f.evidence),
    unverified,
    limitedChecks: unverified.includes("mint/freeze authority") || unverified.includes("holder concentration"),
  };
}
