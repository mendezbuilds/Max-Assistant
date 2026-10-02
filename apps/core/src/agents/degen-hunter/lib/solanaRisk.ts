// Degen Hunter v1 - Phase 4: Risk Analysis
// Solana blockchain risk analysis utilities

import { fetchWithRetry } from "../../../lib/http";
import { rpcEndpoint, redactRpc } from "./rpc";
import { DegenToken } from "../types";

// Cache for RPC responses within a single run to avoid duplicate requests
const rpcCache = new Map<string, any>();

// The RPC endpoint comes from rpc.ts, read at call time (see the note there: a
// module-level constant here froze the public default and ignored SOLANA_RPC_ENDPOINT).

/**
 * Make a Solana RPC call with caching and retry logic
 */
async function solanaRpcCall(method: string, params: any[]): Promise<any> {
  // Create a cache key from method and params
  const cacheKey = `${method}:${JSON.stringify(params)}`;

  // Return cached result if available
  if (rpcCache.has(cacheKey)) {
    return rpcCache.get(cacheKey);
  }

  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  };

  try {
    const response = await fetchWithRetry(rpcEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: 10000, // 10 second timeout
      retries: 2,
    });

    if (!response.ok) {
      throw new Error(`Solana RPC returned ${response.status}`);
    }

    const data = await response.json();

    // Check for RPC error
    if (data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'message' in data.error) {
      throw new Error(String(data.error.message));
    }

    // Check for result
    if (data && typeof data === 'object' && 'result' in data) {
      // Cache successful result
      rpcCache.set(cacheKey, data.result);
      return data.result;
    }

    throw new Error('Invalid RPC response');
  } catch (error) {
    // Redacted: provider URLs carry the API key, and the raw error message includes the URL.
    const msg = redactRpc(error instanceof Error ? error.message : String(error));
    console.warn(`[degen-hunter] Solana RPC call failed (${method}): ${msg}`);
    throw new Error(msg);
  }
}

/**
 * Get mint authority and freeze authority for a SPL token mint address
 */
export async function getTokenAuthorities(mintAddress: string): Promise<{
  /** null = renounced (a real, checked answer); undefined = the lookup failed, so unknown. */
  mintAuthority: string | null | undefined;
  freezeAuthority: string | null | undefined;
}> {
  // A failed lookup used to return null here, and null means "renounced = safe", so
  // an RPC error was indistinguishable from a clean token. undefined keeps "couldn't
  // check" separate from "checked and clear".
  const unknown = { mintAuthority: undefined, freezeAuthority: undefined };
  try {
    const accountInfo = await solanaRpcCall("getAccountInfo", [
      mintAddress,
      { encoding: "jsonParsed" },
    ]);

    if (!accountInfo || !accountInfo.value) return unknown;

    const parsed = accountInfo.value.data.parsed;
    if (!parsed || !parsed.info) return unknown;

    const info = parsed.info;

    return {
      mintAuthority: info.mintAuthority ?? null,
      freezeAuthority: info.freezeAuthority ?? null,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[degen-hunter] Failed to get authorities for ${mintAddress}: ${msg}`);
    return unknown;
  }
}

/**
 * Get token holder concentration (simplified version)
 * Returns the percentage of supply held by the top N holders
 * Note: This can be expensive; we'll limit to top 10 holders for now
 */
export async function getHolderConcentration(mintAddress: string): Promise<{
  topHolderConcentration: number | undefined;
  holderCount: number | undefined;
}> {
  try {
    // First get token supply
    const supplyResponse = await solanaRpcCall("getTokenSupply", [mintAddress]);
    if (!supplyResponse || !supplyResponse.value) {
      return { topHolderConcentration: undefined, holderCount: undefined };
    }

    const supply = parseFloat(supplyResponse.value.uiAmountString || "0");
    if (supply <= 0) {
      return { topHolderConcentration: undefined, holderCount: undefined };
    }

    // Get top token accounts (largest holdings)
    const topAccounts = await solanaRpcCall("getTokenLargestAccounts", [mintAddress]);
    if (!topAccounts || !topAccounts.value || !Array.isArray(topAccounts.value)) {
      return { topHolderConcentration: undefined, holderCount: undefined };
    }

    // Calculate concentration of top 10 holders
    const topN = 10;
    const topAccountsSlice = topAccounts.value.slice(0, topN);
    let topHoldersAmount = 0;

    for (const account of topAccountsSlice) {
      if (account.uiAmountString !== undefined) {
        const amount = parseFloat(account.uiAmountString);
        if (!isNaN(amount)) {
          topHoldersAmount += amount;
        }
      }
    }

    const topHolderConcentration = (topHoldersAmount / supply) * 100;

    // Get total holder count (approximate via signature count? Not directly available)
    // We'll leave holderCount undefined for now as it requires more complex computation
    return {
      topHolderConcentration: parseFloat(topHolderConcentration.toFixed(2)),
      holderCount: undefined
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[degen-hunter] Failed to get holder concentration for ${mintAddress}: ${msg}`);
    return { topHolderConcentration: undefined, holderCount: undefined };
  }
}

/**
 * Check if liquidity is locked by checking against known locker contracts
 * Note: This is a simplified implementation; in practice we'd check specific LP token holdings
 */
export async function checkLiquidityLock(
  pairAddress: string,
  chain: string
): Promise<{
  liquidityLocked: boolean | undefined;
  liquidityLockDetails: string | undefined;
}> {
  // For Phase 4, we'll leave this as undefined since it requires knowing locker contract addresses
  // and checking LP token holdings, which is complex without additional infrastructure
  return { liquidityLocked: undefined, liquidityLockDetails: undefined };
}

/**
 * Check for potential honeypot risks by analyzing buy/sell taxes and transaction patterns
 * Note: This is a placeholder; actual honeypot detection requires simulation or detailed transaction analysis
 */
export function analyzeHoneypotRisk(token: Partial<DegenToken>): {
  honeypotStatus: "safe-looking" | "suspicious" | "honeypot-risk" | "unknown";
  buyTaxPercent: number | undefined;
  sellTaxPercent: number | undefined;
} {
  // If we have explicit tax data from the source, use it
  const buyTax = token.buyTaxPercent ?? undefined;
  const sellTax = token.sellTaxPercent ?? undefined;

  // Simple heuristic: high taxes (>50%) or inability to sell (sell tax 100%) indicate honeypot risk
  if ((buyTax !== undefined && buyTax > 50) ||
      (sellTax !== undefined && sellTax > 50) ||
      (sellTax === 100)) {
    return {
      honeypotStatus: "honeypot-risk" as const,
      buyTaxPercent: buyTax,
      sellTaxPercent: sellTax,
    };
  }

  // Moderate taxes (5-50%) might be suspicious but not definitive
  if ((buyTax !== undefined && buyTax > 5) ||
      (sellTax !== undefined && sellTax > 5)) {
    return {
      honeypotStatus: "suspicious" as const,
      buyTaxPercent: buyTax,
      sellTaxPercent: sellTax,
    };
  }

  // Low or no taxes appear safe-looking
  if (buyTax !== undefined && sellTax !== undefined) {
    // We have actual tax data and it's within safe range
    return {
      honeypotStatus: "safe-looking" as const,
      buyTaxPercent: buyTax,
      sellTaxPercent: sellTax,
    };
  }

  // No tax data available at all — cannot confirm safety
  return {
    honeypotStatus: "unknown" as const,
    buyTaxPercent: buyTax,
    sellTaxPercent: sellTax,
  };
}

/**
 * Calculate risk score (0-100) based on risk factors
 * Higher score = higher risk
 */
export function calculateRiskScore(token: Partial<DegenToken>): number {
  let riskScore = 0;
  const maxScore = 100;

  // Mint authority active (risky if not renounced)
  if (token.mintAuthorityActive !== undefined) {
    if (token.mintAuthorityActive) {
      riskScore += 20; // Mint authority active is risky
    }
    // If renounced (false), that's good - no points added
  }

  // Freeze authority active (risky if not renounced)
  if (token.freezeAuthorityActive !== undefined) {
    if (token.freezeAuthorityActive) {
      riskScore += 20; // Freeze authority active is risky
    }
  }

  // Holder concentration (risky if top holders control too much)
  if (token.topHolderConcentration !== undefined) {
    if (token.topHolderConcentration > 50) {
      riskScore += 20; // >50% held by top holders is very risky
    } else if (token.topHolderConcentration > 30) {
      riskScore += 10; // 30-50% is moderately risky
    }
  }

  // Liquidity not locked (risky)
  if (token.liquidityLocked !== undefined && !token.liquidityLocked) {
    riskScore += 15; // Unlocked liquidity is risky
  }

  // Honeypot risk
  if (token.honeypotStatus === "honeypot-risk") {
    riskScore += 25; // High risk
  } else if (token.honeypotStatus === "suspicious") {
    riskScore += 10; // Medium risk
  }

  // Buy/sell taxes (high taxes = risky)
  const buyTax = token.buyTaxPercent ?? 0;
  const sellTax = token.sellTaxPercent ?? 0;
  if (buyTax > 10 || sellTax > 10) {
    riskScore += 10; // Taxes >10% add risk
  }

  // Contract not verified (risky)
  if (token.contractVerified === false) {
    riskScore += 10; // Unverified contract is risky
  }

  // Ownership not renounced (risky if we know it's not renounced)
  if (token.ownershipRenounced === false) {
    riskScore += 5; // Ownership not renounced adds some risk
  }

  // Ensure score is within bounds
  return Math.min(Math.max(riskScore, 0), maxScore);
}

/**
 * Populate risk-related fields on a token by fetching data from Solana blockchain
 */
export async function populateRiskData(token: DegenToken): Promise<DegenToken> {
  // Only process Solana tokens for now (as per v1 scope)
  if (token.chain !== "solana") {
    return token;
  }

  try {
    // Get mint and freeze authorities
    const authorities = await getTokenAuthorities(token.contractAddress);
    // Only record what was actually checked; leave unknown as unknown.
    if (authorities.mintAuthority !== undefined) token.mintAuthorityActive = authorities.mintAuthority !== null;
    if (authorities.freezeAuthority !== undefined) token.freezeAuthorityActive = authorities.freezeAuthority !== null;

    // Get holder concentration (optional, may be expensive)
    const holderData = await getHolderConcentration(token.contractAddress);
    if (holderData.topHolderConcentration !== undefined) {
      token.topHolderConcentration = holderData.topHolderConcentration;
    }
    // Note: holderCount is not in DegenToken interface, so we don't store it

    // Check liquidity lock (if we have pair address)
    if (token.pairAddress) {
      const lockData = await checkLiquidityLock(token.pairAddress, token.chain);
      if (lockData.liquidityLocked !== undefined) {
        token.liquidityLocked = lockData.liquidityLocked;
        token.liquidityLockDetails = lockData.liquidityLockDetails;
      }
    }

    // Analyze honeypot risk based on available data
    const honeypotAnalysis = analyzeHoneypotRisk(token);
    token.honeypotStatus = honeypotAnalysis.honeypotStatus;
    token.buyTaxPercent = honeypotAnalysis.buyTaxPercent;
    token.sellTaxPercent = honeypotAnalysis.sellTaxPercent;

    // Calculate risk score
    token.riskScore = calculateRiskScore(token);

    // Risk flags, warnings and the risk level are NOT assigned here. They are derived in one place,
    // assessRisk() (@max/shared), from the data gathered above plus the market data — so the level
    // can never disagree with the flags. See applyRiskAssessment() in ../index.ts.

    // Note: We don't have contract verification data from DexScreener, so we leave it undefined
    // In a later phase we could integrate with explorers to get contract verification status

    return token;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[degen-hunter] Failed to populate risk data for ${token.symbol}: ${msg}`);
    // Return token as-is if risk data population fails
    return token;
  }
}