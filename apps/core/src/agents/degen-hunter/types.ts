// Degen Hunter v2 - Phase 2: Foundation
// Core token data model and related types

/**
 * Comprehensive token data model as specified in Degen Hunter v2 spec
 * All fields are optional to accommodate partial data from various sources
 */
export interface DegenToken {
  // Basic identification
  id: string;
  name: string;
  symbol: string;
  chain: string;
  contractAddress: string;

  // Optional fields (may be undefined based on data availability)
  pairAddress?: string;
  logoUrl?: string;
  websiteUrl?: string;
  chartUrl?: string;
  explorerUrl?: string;
  dexUrl?: string;
  socialLinks?: string[];

  // Price data (USD)
  priceUsd?: number;
  priceChange5m?: number;
  priceChange1h?: number;
  priceChange6h?: number;
  priceChange24h?: number;

  // Market data
  marketCapUsd?: number;
  fdvUsd?: number;
  liquidityUsd?: number;

  // Volume data (USD)
  volume5mUsd?: number;
  volume1hUsd?: number;
  volume6hUsd?: number;
  volume24hUsd?: number;

  // Trading activity
  buys5m?: number;
  sells5m?: number;
  buys1h?: number;
  sells1h?: number;
  buys24h?: number;
  sells24h?: number;

  // Holder information
  holders?: number;
  holderGrowth?: number;
  tokenAgeMinutes?: number;
  pairCreatedAt?: string;

  // Liquidity and security
  liquidityLocked?: boolean;
  liquidityLockDetails?: string;
  mintAuthorityActive?: boolean;
  freezeAuthorityActive?: boolean;
  honeypotStatus?: "safe-looking" | "suspicious" | "honeypot-risk" | "unknown";
  buyTaxPercent?: number;
  sellTaxPercent?: number;
  contractVerified?: boolean;
  ownershipRenounced?: boolean;

  // Concentration risks
  topHolderConcentration?: number;
  developerHoldingPercent?: number;

  // Scoring components (0-100 scale)
  socialActivityScore?: number;
  momentumScore?: number;
  liquidityScore?: number;
  volumeScore?: number;
  contractSafetyScore?: number;
  communityScore?: number;
  buySellScore?: number; // Buy/sell pressure score
  dataScore?: number; // Data confidence score

  // Composite scores
  riskScore?: number;
  totalScore?: number;

  // Risk tracking. All of this is produced by assessRisk() (@max/shared) from the
  // fields above: the level is DERIVED FROM riskFlags, so they can't disagree, and
  // every level above "low" has at least one flag/warning explaining it.
  riskFlags: string[];
  warnings: string[];
  evidence: string[];
  riskLevel?: "low" | "medium" | "high" | "critical";
  /** Checks that could not be run (so "no flag" there means unknown, not fine). */
  riskUnverified?: string[];

  // Metadata
  discoverySource: string;
  discoveredAt: string; // ISO timestamp
  lastUpdatedAt: string; // ISO timestamp

  // Status tracking
  status: "new" | "watching" | "alerted" | "bought" | "sold" | "ignored" | "blacklisted" | "expired";
}

/**
 * Discovery rule configuration (configurable from dashboard)
 */
export interface DiscoveryRule {
  enabled: boolean;
  chain?: string;
  minLiquidityUsd?: number;
  maxMarketCapUsd?: number;
  minVolume24hUsd?: number;
  minTokenAgeMinutes?: number;
  maxTokenAgeMinutes?: number;
  minBuySellRatio?: number;
  minHolderGrowth?: number;
  minMomentumScore?: number;
  maxRiskScore?: number;
}

/**
 * Default discovery profiles (editable from dashboard)
 */
export interface DiscoveryProfiles {
  newMeme: DiscoveryRule;
  momentum: DiscoveryRule;
  lowCap: DiscoveryRule;
  trending: DiscoveryRule;
}

/**
 * Token outcome tracking (for analytics)
 */
export interface DegenOutcome {
  tokenId: string;
  action: "watched" | "bought" | "sold" | "ignored" | "blacklisted";
  entryPrice?: number;
  exitPrice?: number;
  amountUsd?: number;
  pnlUsd?: number;
  pnlPercent?: number;
  confirmedByUser: boolean;
  notes?: string;
  recordedAt: string; // ISO timestamp
}

/**
 * Risk labels that can be applied to tokens
 */
export type RiskLabel =
  | "high-risk"
  | "extreme-risk"
  | "honeypot-risk"
  | "low-liquidity"
  | "unverified-contract"
  | "high-holder-concentration"
  | "liquidity-unlocked"
  | "mint-authority-active"
  | "freeze-authority-active"
  | "tax-risk"
  | "fake-volume-risk"
  | "social-source-unverified"
  | "data-incomplete"
  | "unknown";

/**
 * Adapter interface for market/data sources
 */
export interface TokenSource {
  name: string; // Unique identifier for the source
  chain?: string; // Optional chain restriction (undefined = all chains)
  fetch(): Promise<DegenToken[]>; // Returns array of normalized token data
}

// Type alias for cleaner code
export type TokenSourceRecord = Record<string, TokenSource>;