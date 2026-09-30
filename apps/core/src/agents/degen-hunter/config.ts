// Degen Hunter v2 - Phase 2: Foundation
// Configuration and default discovery profiles

import { DiscoveryRule, DiscoveryProfiles } from "./types";

/**
 * Default discovery profiles
 * All thresholds are editable from the dashboard as per spec
 */
export const DEFAULT_DISCOVERY_PROFILES: DiscoveryProfiles = {
  // New meme: newly created, meme/narrative category, min liquidity/activity, no severe contract warning
  newMeme: {
    enabled: true,
    minLiquidityUsd: 5000, // $5k minimum liquidity
    maxMarketCapUsd: 50000, // $50k max market cap
    minVolume24hUsd: 1000, // $1k minimum 24h volume
    minTokenAgeMinutes: 0, // brand new tokens allowed
    maxTokenAgeMinutes: 60 * 24, // max 1 day old
    minBuySellRatio: 0.8, // at least 80% as many buys as sells
    minHolderGrowth: 10, // minimum 10 new holders per hour
    minMomentumScore: 30, // minimum momentum score
    maxRiskScore: 60, // maximum risk score (lower is safer)
  },

  // Momentum: strong short-term volume, positive buy/sell imbalance, increasing liquidity/price, acceptable risk
  momentum: {
    enabled: true,
    minLiquidityUsd: 10000, // $10k minimum liquidity
    maxMarketCapUsd: 200000, // $200k max market cap
    minVolume24hUsd: 5000, // $5k minimum 24h volume
    minTokenAgeMinutes: 0,
    maxTokenAgeMinutes: 60 * 24 * 7, // max 1 week old
    minBuySellRatio: 1.2, // at least 20% more buys than sells
    minHolderGrowth: 20, // minimum 20 new holders per hour
    minMomentumScore: 50, // minimum momentum score
    maxRiskScore: 50, // maximum risk score
  },

  // Low-cap: low mcap, min liquidity, active trading/holders, contract risk analysis
  lowCap: {
    enabled: true,
    minLiquidityUsd: 20000, // $20k minimum liquidity
    maxMarketCapUsd: 100000, // $100k max market cap
    minVolume24hUsd: 2000, // $2k minimum 24h volume
    minTokenAgeMinutes: 30, // at least 30 minutes old
    maxTokenAgeMinutes: 60 * 24 * 30, // max 30 days old
    minBuySellRatio: 0.9, // at least 90% as many buys as sells
    minHolderGrowth: 5, // minimum 5 new holders per hour
    minMomentumScore: 20, // minimum momentum score
    maxRiskScore: 70, // maximum risk score (more tolerant of risk for low-cap)
  },

  // Trending: increasing volume, social attention, new pair activity, stronger-than-normal buying
  trending: {
    enabled: true,
    minLiquidityUsd: 15000, // $15k minimum liquidity
    maxMarketCapUsd: 150000, // $150k max market cap
    minVolume24hUsd: 8000, // $8k minimum 24h volume
    minTokenAgeMinutes: 0,
    maxTokenAgeMinutes: 60 * 24 * 14, // max 2 weeks old
    minBuySellRatio: 1.1, // at least 10% more buys than sells
    minHolderGrowth: 15, // minimum 15 new holders per hour
    minMomentumScore: 40, // minimum momentum score
    maxRiskScore: 55, // maximum risk score
  },
};

/**
 * Default chain settings
 * Can be overridden per-chain in discovery rules
 */
export const SUPPORTED_CHAINS = [
  "solana",
  "ethereum",
  "base",
  "bnb-chain",
  "arbitrum",
  "avalanche",
  "sui",
  "aptos",
] as const;

export type SupportedChain = typeof SUPPORTED_CHAINS[number];

/**
 * Default scoring weights (0-100 points total)
 * As specified in the spec: Liquidity(20) + Volume(15) + Buy/Sell(15) + Momentum(15) + Holder(10) + Contract(15) + Social(5) + Data(5) = 100
 */
export const SCORING_WEIGHTS = {
  liquidityQuality: 20,
  volumeActivity: 15,
  buySellPressure: 15,
  momentum: 15,
  holderGrowth: 10,
  contractSafety: 15,
  socialCommunity: 5,
  dataConfidence: 5,
};

/**
 * Risk score thresholds for interpretation
 * As specified in the spec
 */
export const RISK_THRESHOLDS = {
  strongSignal: 90, // 90-100: "Strong signal, still high-risk"
  worthMonitoring: 75, // 75-89: Worth monitoring
  speculativeWatchlist: 60, // 60-74: Speculative watchlist
  weakSignal: 40, // 40-59: Weak signal
  reject: 0, // 0-39: Reject/archive
};

/**
 * Default scheduler intervals (in cron format)
 * These will be used in the main index.ts to register jobs
 */
export const SCHEDULER_INTERVALS = {
  // New token discovery - every 15 minutes (can be made configurable)
  discovery: "*/15 * * * *",

  // Market data refresh - every 5 minutes
  marketDataRefresh: "*/5 * * * *",

  // Contract risk analysis - every 30 minutes
  contractRiskRefresh: "*/30 * * * *",

  // Momentum analysis - every 10 minutes
  momentumAnalysis: "*/10 * * * *",

  // Telegram alerts - every 5 minutes (batched updates)
  telegramAlerts: "*/5 * * * *",

  // Watchlist updates - every hour
  watchlistUpdates: "0 * * * *",

  // Price/liquidity alerts - every 15 minutes
  priceLiquidityAlerts: "*/15 * * * *",

  // Daily digest - every day at 9:00 AM
  dailyDigest: "0 9 * * *",

  // Expired token cleanup - every day at 2:00 AM
  expiredCleanup: "0 2 * * *",
};