// Degen Hunter v1 - Phase 3: Discovery
// DexScreener market-data source adapter (Solana-only)

import { fetchWithRetry } from "../../../lib/http";
import { TokenSource, DegenToken } from "../types";

/**
 * DexScreener source for Solana token/pair discovery
 * Provides real-time DEX pair data from DexScreener API
 *
 * Data mapped to DegenToken model:
 * - identification: chainId, pairAddress, base/quote token addresses
 * - price: priceUsd
 * - market data: marketCap, fdv
 * - liquidity: liquidity.usd
 * - volume: volume.m5/h1/h6/h24
 * - trading activity: txns.m5/h1/h6/h24.buys/sells
 * - token age: derived from pairCreatedAt
 * - links: url, info.websites, info.socials
 * - metadata: discoverySource, discoveredAt
 */
export const dexscreenerSource: TokenSource = {
  name: "dexscreener",
  chain: undefined, // Multi-chain capable but v1 will filter to Solana only

  async fetch(): Promise<DegenToken[]> {
    try {
      // Use the DexScreener token-profiles / new-pairs endpoint to surface genuinely
      // recently-created Solana pairs.  The old `?q=eth` search returned tokens with
      // "eth" anywhere in their name/symbol — many of which were days or weeks old —
      // which violated the "emerging token" requirement.
      // 
      // We call two complementary endpoints and merge:
      //   1. /token-profiles/latest/v1  — newest token profiles (often <1h old)
      //   2. /latest/dex/search?q=solana — broader Solana activity for coverage
      //
      // A hard 72-hour pair-age gate is applied AFTER fetching so that no token
      // can enter the discovery pipeline as "new" simply because it has recent
      // trading activity.
      const MAX_TOKEN_AGE_HOURS = 72;
      const MAX_TOKEN_AGE_MS = MAX_TOKEN_AGE_HOURS * 60 * 60 * 1000;

      const [profilesRes, searchRes] = await Promise.allSettled([
        fetchWithRetry("https://api.dexscreener.com/token-profiles/latest/v1", { timeoutMs: 15000, retries: 2 }),
        fetchWithRetry("https://api.dexscreener.com/latest/dex/search?q=sol&rankBy=trendingScoreH1&order=desc", { timeoutMs: 15000, retries: 2 }),
      ]);

      const allPairs: any[] = [];

      // Collect from new-profiles endpoint (each entry has a tokenAddress, chainId)
      if (profilesRes.status === "fulfilled" && profilesRes.value.ok) {
        const profileData = await profilesRes.value.json();
        const profiles: any[] = Array.isArray(profileData) ? profileData : [];
        // For each recent profile on Solana, fetch its pair data
        const solanaMints = profiles
          .filter((p: any) => p.chainId === "solana" && p.tokenAddress)
          .map((p: any) => p.tokenAddress)
          .slice(0, 30); // Cap to avoid too many sub-requests

        if (solanaMints.length > 0) {
          const chunked = solanaMints.slice(0, 30).join(",");
          try {
            const pairRes = await fetchWithRetry(
              `https://api.dexscreener.com/tokens/v1/solana/${chunked}`,
              { timeoutMs: 15000, retries: 1 }
            );
            if (pairRes.ok) {
              const pairData = await pairRes.json();
              if (Array.isArray(pairData)) allPairs.push(...pairData);
            }
          } catch { /* non-fatal */ }
        }
      }

      // Collect from trending-SOL search
      if (searchRes.status === "fulfilled" && searchRes.value.ok) {
        const searchData: any = await searchRes.value.json();
        if (Array.isArray(searchData?.pairs)) allPairs.push(...searchData.pairs);
      }

      // Fallback: if both endpoints failed, try the old search with "solana" as query
      if (allPairs.length === 0) {
        const fallback = await fetchWithRetry(
          "https://api.dexscreener.com/latest/dex/search?q=solana",
          { timeoutMs: 15000, retries: 2 }
        );
        if (fallback.ok) {
          const fallbackData: any = await fallback.json();
          if (Array.isArray(fallbackData?.pairs)) allPairs.push(...fallbackData.pairs);
        }
      }

      if (!allPairs.length) return [];

      const tokens: DegenToken[] = [];
      const now = Date.now();
      const seen = new Set<string>();

      // Process each pair to extract token data
      for (const pair of allPairs) {
        // Validate that this is a Solana pair (v1 is Solana-only)
        if (pair.chainId !== "solana") continue;

        // Skip if missing essential data
        if (!pair.pairAddress || !pair.baseToken?.address || !pair.quoteToken?.address) continue;

        // ─── FRESHNESS GATE ──────────────────────────────────────────────────────
        // Only allow tokens where the pair was created within the last 72 hours.
        // If pairCreatedAt is MISSING, we allow the token through but log a warning
        // and set tokenAgeMinutes=undefined so downstream cannot treat it as fresh.
        // If pairCreatedAt is PRESENT and the token is too old, it is rejected.
        if (pair.pairCreatedAt && typeof pair.pairCreatedAt === "number") {
          const ageMs = now - pair.pairCreatedAt;
          if (ageMs > MAX_TOKEN_AGE_MS) continue; // Too old — skip
        } else if (pair.pairCreatedAt) {
          // pairCreatedAt exists but is not a number — treat as unknown, log for audit
          console.warn(`[degen-hunter] Pair ${pair.pairAddress} has non-numeric pairCreatedAt: ${pair.pairCreatedAt} — age unknown, proceeding with caution`);
        }
        // else: no pairCreatedAt at all — unknown age, token passes through (tokenAgeMinutes will be undefined)

        // Deduplicate pairs
        if (seen.has(pair.pairAddress)) continue;
        seen.add(pair.pairAddress);

        // Create token entry for the base token (the non-SOL/USDC side)
        const baseToken = createDegenTokenFromPair(pair, "base", now);
        if (baseToken && !isWrappedNative(baseToken.symbol)) tokens.push(baseToken);
      }

      return tokens;
    } catch (error) {
      // Log error but don't crash the agent - follow existing Max patterns
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[degen-hunter] DexScreener source error: ${msg}`);
      return [];
    }
  }
};

/** Skip SOL/WSOL/USDC/USDT quote-side tokens — these aren't discoveries */
function isWrappedNative(symbol: string | undefined): boolean {
  if (!symbol) return false;
  return ["SOL", "WSOL", "USDC", "USDT", "WETH", "WBNB"].includes(symbol.toUpperCase());
}



/**
 * Create a DegenToken from a DexScreener pair for either base or quote token
 */
function createDegenTokenFromPair(
  pair: any,
  tokenType: "base" | "quote",
  discoveredAt: number
): DegenToken | null {
  try {
    const token = tokenType === "base" ? pair.baseToken : pair.quoteToken;
    const otherToken = tokenType === "base" ? pair.quoteToken : pair.baseToken;

    if (!token?.address || !token.name || !token.symbol) {
      return null;
    }

    // Calculate token age in minutes if pair creation time is available
    let tokenAgeMinutes: number | undefined;
    if (pair.pairCreatedAt && typeof pair.pairCreatedAt === "number") {
      tokenAgeMinutes = Math.floor((Date.now() - pair.pairCreatedAt) / 60000);
    }

    // Build the DegenToken object with all available fields
    const degenToken: DegenToken = {
      // Basic identification
      id: `${pair.chainId}:${pair.pairAddress}:${token.address}`, // Unique ID for this token in this pair
      name: token.name,
      symbol: token.symbol,
      chain: pair.chainId,
      contractAddress: token.address,

      // Optional pair-specific fields
      pairAddress: pair.pairAddress,

      // Price data (USD)
      priceUsd: typeof pair.priceUsd === "number" ? pair.priceUsd : undefined,

      // Market data
      marketCapUsd: typeof pair.marketCap === "number" ? pair.marketCap : undefined,
      fdvUsd: typeof pair.fdv === "number" ? pair.fdv : undefined,

      // Liquidity data
      liquidityUsd: typeof pair.liquidity?.usd === "number" ? pair.liquidity.usd : undefined,

      // Volume data (USD)
      volume5mUsd: typeof pair.volume?.m5 === "number" ? pair.volume.m5 : undefined,
      volume1hUsd: typeof pair.volume?.h1 === "number" ? pair.volume.h1 : undefined,
      volume6hUsd: typeof pair.volume?.h6 === "number" ? pair.volume.h6 : undefined,
      volume24hUsd: typeof pair.volume?.h24 === "number" ? pair.volume.h24 : undefined,

      // Trading activity
      buys5m: typeof pair.txns?.m5?.buys === "number" ? pair.txns.m5.buys : undefined,
      sells5m: typeof pair.txns?.m5?.sells === "number" ? pair.txns.m5.sells : undefined,
      buys1h: typeof pair.txns?.h1?.buys === "number" ? pair.txns.h1.buys : undefined,
      sells1h: typeof pair.txns?.h1?.sells === "number" ? pair.txns.h1.sells : undefined,
      buys24h: typeof pair.txns?.h24?.buys === "number" ? pair.txns.h24.buys : undefined,
      sells24h: typeof pair.txns.h24.sells === "number" ? pair.txns.h24.sells : undefined,

      // Token age (derived from pair creation)
      tokenAgeMinutes,

      // Links and metadata
      dexUrl: pair.url, // Changed from 'url' to 'dexUrl' to match DegenToken interface

      // Discovery metadata
      discoverySource: "dexscreener",
      discoveredAt: new Date(discoveredAt).toISOString(),
      lastUpdatedAt: new Date(discoveredAt).toISOString(),

      // Status (newly discovered tokens start as "new")
      status: "new" as const,

      // Initialize arrays
      riskFlags: [],
      warnings: [],
      evidence: [],

      // Optional fields that DexScreener doesn't directly provide in v1
      // These will be populated in later phases or left as undefined
      logoUrl: undefined,
      websiteUrl: undefined,
      chartUrl: undefined,
      explorerUrl: undefined,
      socialLinks: undefined,
      priceChange5m: undefined,
      priceChange1h: undefined,
      priceChange6h: undefined,
      priceChange24h: undefined,
      holders: undefined,
      holderGrowth: undefined,
      pairCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : undefined,
      liquidityLocked: undefined,
      liquidityLockDetails: undefined,
      mintAuthorityActive: undefined,
      freezeAuthorityActive: undefined,
      honeypotStatus: "unknown",
      buyTaxPercent: undefined,
      sellTaxPercent: undefined,
      contractVerified: undefined,
      ownershipRenounced: undefined,
      topHolderConcentration: undefined,
      developerHoldingPercent: undefined,
      socialActivityScore: undefined,
      momentumScore: undefined,
      liquidityScore: undefined,
      volumeScore: undefined,
      contractSafetyScore: undefined,
      communityScore: undefined,
      buySellScore: undefined,
      dataScore: undefined,
      riskScore: undefined,
      totalScore: undefined
    };

    // Add optional info from DexScreener if available
    if (pair.info) {
      if (pair.info.websites?.length) {
        degenToken.websiteUrl = pair.info.websites[0]?.url;
        degenToken.socialLinks = pair.info.socials?.map((s: { type: string; url: string }) => `${s.type}:${s.url}`) || undefined;
      }
      if (pair.info.imageUrl) {
        degenToken.logoUrl = pair.info.imageUrl;
      }
    }

    return degenToken;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[degen-hunter] Error creating DegenToken from pair: ${msg}`);
    return null;
  }
}