/**
 * Dashboard-side representation of a Degen Hunter token.
 * Fields exactly mirror DegenToken from apps/core but are all optional
 * since records in the DB may have been written by different agent versions.
 *
 * Never fabricate values — render null/undefined as "—" or "Unknown".
 */
export interface DashboardToken {
  // DB row meta
  _rowId: number;
  _updatedAt: string;
  tokenId: string;

  // Identity
  id?: string;
  name?: string;
  symbol?: string;
  chain?: string;
  contractAddress?: string;
  pairAddress?: string;

  // Links
  logoUrl?: string;
  websiteUrl?: string;
  chartUrl?: string;
  explorerUrl?: string;
  dexUrl?: string;
  socialLinks?: string[];

  // Price
  priceUsd?: number;
  priceChange5m?: number;
  priceChange1h?: number;
  priceChange6h?: number;
  priceChange24h?: number;

  // Market
  marketCapUsd?: number;
  fdvUsd?: number;
  liquidityUsd?: number;

  // Volume
  volume24hUsd?: number;
  volume1hUsd?: number;
  volume6hUsd?: number;
  volume5mUsd?: number;

  // Trading
  buys24h?: number;
  sells24h?: number;
  buys1h?: number;
  sells1h?: number;
  buys5m?: number;
  sells5m?: number;

  // Holder info
  holders?: number;
  holderGrowth?: number;
  tokenAgeMinutes?: number;
  pairCreatedAt?: string;
  topHolderConcentration?: number;
  developerHoldingPercent?: number;

  // Security
  liquidityLocked?: boolean;
  liquidityLockDetails?: string;
  mintAuthorityActive?: boolean;
  freezeAuthorityActive?: boolean;
  honeypotStatus?: string;
  buyTaxPercent?: number;
  sellTaxPercent?: number;
  contractVerified?: boolean;
  ownershipRenounced?: boolean;

  // Source
  discoverySource?: string;
  discoveredAt?: string;
  lastUpdatedAt?: string;
  status?: string;

  // Scoring
  totalScore?: number;
  riskScore?: number;
  liquidityScore?: number;
  volumeScore?: number;
  buySellScore?: number;
  momentumScore?: number;
  communityScore?: number;
  contractSafetyScore?: number;
  socialActivityScore?: number;
  dataScore?: number;

  // Risk
  riskFlags?: string[];
  warnings?: string[];
  evidence?: string[];
}
