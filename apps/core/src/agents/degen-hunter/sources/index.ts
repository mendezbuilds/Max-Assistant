// Degen Hunter v2 - Phase 2: Foundation
// Source adapter interface and placeholder for future market-data providers

import { TokenSource, DegenToken } from "../types";
import { dexscreenerSource } from "./dexscreener";

/**
 * Source adapter interface for market/data sources
 * Each specific source (DEX aggregators, explorers, social signals, etc.)
 * should implement this interface and be added to the ALL_SOURCES array below.
 *
 * Following the same pattern as existing agents like job-scout:
 * - Implement the source by providing a fetch() method that returns normalized DegenToken data
 * - Add the source instance to the ALL_SOURCES array
 * - Nothing else in the pipeline needs to change when adding new sources
 */

/**
 * Placeholder for future market-data sources
 * In later phases, these will be replaced with actual implementations
 * connecting to providers like:
 * - DEX aggregators (1inch, Paraswap, etc.)
 * - Price feeds (CoinGecko, CoinMarketCap, etc.)
 * - Blockchain explorers (Etherscan, Solscan, etc.)
 * - Social signal providers (Twitter/X API, Discord, etc.)
 * - On-chain data providers (Covalent, Alchemy, etc.)
 */

/**
 * Active sources for Degen Hunter v1 (Solana-only discovery)
 * Start with DexScreener as the first real market-data provider
 */
export const ALL_SOURCES: TokenSource[] = [
  dexscreenerSource
];

// Helper function to get source names for logging/monitoring
export const getSourceNames = (): string[] =>
  ALL_SOURCES.map(source => source.name);

// Export the TokenSource interface for use by individual source files
export type { TokenSource };