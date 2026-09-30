// Degen Hunter v2 - Phase 4: Risk Analysis
// Main agent entry point following the same pattern as existing agents

import { filterUnseen, markSeen } from "@max/db";
import { log } from "../../logger";
import { ALL_SOURCES, getSourceNames } from "./sources";
import { DegenToken } from "./types";
import { DEFAULT_DISCOVERY_PROFILES, SCORING_WEIGHTS, RISK_THRESHOLDS } from "./config";
import { populateRiskData } from "./lib/solanaRisk";
import { sendTokenAlert, startBot } from "./telegram/bot";
import { notify } from "../../telegram";

const AGENT_KEY = "degen-hunter";

/**
 * Apply discovery rules to filter tokens
 * In Phase 2, we return all tokens - actual filtering implemented in later phases
 */
function applyDiscoveryRules(tokens: DegenToken[]): DegenToken[] {
  // Phase 2: Return all tokens for now
  // Actual discovery rule filtering will be implemented in Phase 3
  return tokens;
}

/**
 * Calculate transparent 0-100 score based on spec weights
 * Now implemented with real scoring algorithm
 */
function calculateScore(token: DegenToken): number {
  // If we have a precomputed totalScore, use it
  if (token.totalScore !== undefined) {
    return token.totalScore;
  }

  // Otherwise, compute and store the scores
  return computeAndStoreScores(token);
}

/**
 * Assign risk level based on score and thresholds
 * Now uses the actual score (totalScore) and thresholds from config
 */
function getRiskLevel(score: number): "low" | "medium" | "high" {
  if (score >= RISK_THRESHOLDS.strongSignal) return "high";
  if (score >= RISK_THRESHOLDS.worthMonitoring) return "medium";
  return "low";
}

/**
 * Generate a basic Telegram alert message for a token
 * In Phase 2, we create a simple placeholder - actual formatting in Phase 5
 */
export function generateTokenAlert(token: DegenToken): string {
  const score = calculateScore(token);
  const riskLevel = getRiskLevel(score);

  return [
    "🔥 DEGEN HUNTER ALERT",
    `Token: ${token.name} ($${token.symbol})`,
    `Chain: ${token.chain}`,
    `Price: $${token.priceUsd?.toFixed(6) ?? "unknown"}`,
    `Market Cap: $${token.marketCapUsd?.toLocaleString() ?? "unknown"}`,
    `Liquidity: $${token.liquidityUsd?.toLocaleString() ?? "unknown"}`,
    `Volume 24h: $${token.volume24hUsd?.toLocaleString() ?? "unknown"}`,
    `Score: ${score}/100`,
    `Risk: ${riskLevel.toUpperCase()}`,
    "",
    "This is a high-risk speculative token. Verify details before acting.",
    "Not financial advice. DYOR."
  ].filter(Boolean).join("\n");
}

/**
 * Compute and store all component scores and totalScore on the token
 * Returns the totalScore
 */
function computeAndStoreScores(token: DegenToken): number {
  // Compute each component score (0-100)
  const liquidityScore = computeLiquidityScore(token.liquidityUsd);
  const volumeScore = computeVolumeScore(token.volume24hUsd);
  const buySellScore = computeBuySellScore(token.buys24h, token.sells24h);
  const momentumScore = computeMomentumScore(token);
  const holderScore = computeHolderScore(token.holderGrowth);
  const contractSafetyScore = computeContractSafetyScore(token);
  const socialScore = computeSocialScore(token);
  const dataScore = computeDataScore(token);

  // Store component scores on the token using the correct field names
  token.liquidityScore = liquidityScore;
  token.volumeScore = volumeScore;
  token.buySellScore = buySellScore;
  token.momentumScore = momentumScore;
  token.communityScore = holderScore; // Using communityScore for holder growth
  token.contractSafetyScore = contractSafetyScore;
  token.socialActivityScore = socialScore; // Using socialActivityScore for social community
  token.dataScore = dataScore;

  // Compute weighted total score (opportunity score)
  const totalScore =
    liquidityScore * SCORING_WEIGHTS.liquidityQuality / 100 +
    volumeScore * SCORING_WEIGHTS.volumeActivity / 100 +
    buySellScore * SCORING_WEIGHTS.buySellPressure / 100 +
    momentumScore * SCORING_WEIGHTS.momentum / 100 +
    holderScore * SCORING_WEIGHTS.holderGrowth / 100 +
    contractSafetyScore * SCORING_WEIGHTS.contractSafety / 100 +
    socialScore * SCORING_WEIGHTS.socialCommunity / 100 +
    dataScore * SCORING_WEIGHTS.dataConfidence / 100;

  // Store totalScore
  token.totalScore = Math.round(totalScore);

  return token.totalScore;
}

/**
 * Compute liquidity quality score (0-100) based on liquidity in USD
 * Higher liquidity = higher score
 */
function computeLiquidityScore(liquidityUsd: number | undefined): number {
  if (liquidityUsd === undefined || liquidityUsd <= 0) return 0;

  // Define liquidity thresholds for scoring
  // These are somewhat arbitrary but based on discovery profile minimums
  const tiers = [
    { min: 50000, score: 100 },   // Excellent liquidity
    { min: 20000, score: 80 },    // Good liquidity (lowCap minimum)
    { min: 10000, score: 60 },    // Decent liquidity (momentum minimum)
    { min: 5000, score: 40 },     // Minimal liquidity (newMeme minimum)
    { min: 0, score: 0 }          // No liquidity
  ];

  for (const tier of tiers) {
    if (liquidityUsd >= tier.min) {
      // Linear interpolation between tiers
      const nextTier = tiers.find(t => t.min < tier.min);
      if (!nextTier) return tier.score;

      const range = tier.min - nextTier.min;
      const scoreRange = tier.score - nextTier.score;
      const position = (liquidityUsd - nextTier.min) / range;
      return Math.round(nextTier.score + position * scoreRange);
    }
  }

  return 0;
}

/**
 * Compute volume activity score (0-100) based on 24h volume in USD
 * Higher volume = higher score
 */
function computeVolumeScore(volume24hUsd: number | undefined): number {
  if (volume24hUsd === undefined || volume24hUsd <= 0) return 0;

  // Define volume thresholds for scoring
  const tiers = [
    { min: 100000, score: 100 },  // High volume
    { min: 50000, score: 80 },    // Good volume
    { min: 20000, score: 60 },    // Moderate volume
    { min: 5000, score: 40 },     // Low volume
    { min: 0, score: 0 }          // No volume
  ];

  for (const tier of tiers) {
    if (volume24hUsd >= tier.min) {
      const nextTier = tiers.find(t => t.min < tier.min);
      if (!nextTier) return tier.score;

      const range = tier.min - nextTier.min;
      const scoreRange = tier.score - nextTier.score;
      const position = (volume24hUsd - nextTier.min) / range;
      return Math.round(nextTier.score + position * scoreRange);
    }
  }

  return 0;
}

/**
 * Compute buy/sell pressure score (0-100) based on buy/sell ratio
 * Higher buy pressure (more buys than sells) = higher score, but extremely high ratios may indicate manipulation
 */
function computeBuySellScore(buys24h: number | undefined, sells24h: number | undefined): number {
  if (buys24h === undefined || sells24h === undefined || sells24h === 0) {
    // If we have buys but no sells, that's extremely bullish but also suspicious
    return buys24h !== undefined && buys24h > 0 ? 80 : 0;
  }

  const ratio = buys24h / sells24h;

  // Score based on ratio:
  // Ratio < 0.5: heavy sell pressure -> low score
  // Ratio 0.5-1.5: balanced to moderate buy pressure -> medium to high score
  // Ratio > 1.5: strong buy pressure -> high score, but cap at extreme ratios
  if (ratio < 0.5) {
    return Math.round((ratio / 0.5) * 40); // 0-40 points
  } else if (ratio <= 1.5) {
    return Math.round(40 + ((ratio - 0.5) / 1.0) * 40); // 40-80 points
  } else {
    // For ratios > 1.5, give diminishing returns to avoid rewarding extreme manipulation
    return Math.round(80 + Math.min(20, ((ratio - 1.5) / 2.0) * 20)); // 80-100 points
  }
}

/**
 * Compute momentum score (0-100) based on price momentum and volume trends
 * This is a simplified implementation; in later phases we can enhance with more sophisticated momentum indicators
 */
function computeMomentumScore(token: DegenToken): number {
  // Use price changes over different timeframes to compute momentum
  const priceChange1h = token.priceChange1h ?? 0;
  const priceChange6h = token.priceChange6h ?? 0;
  const priceChange24h = token.priceChange24h ?? 0;

  // Normalize price changes to a 0-100 scale
  // We'll use a simple average of the absolute price changes, capped at 100% change
  const absChange1h = Math.min(Math.abs(priceChange1h), 100);
  const absChange6h = Math.min(Math.abs(priceChange6h), 100);
  const absChange24h = Math.min(Math.abs(priceChange24h), 100);

  // Weight recent changes more heavily
  const weightedChange = (absChange1h * 0.5) + (absChange6h * 0.3) + (absChange24h * 0.2);

  // Convert to a score where 0% change = 50 (neutral), 100% change = 100 (strong momentum)
  // We'll also consider the direction (positive change is better for momentum score)
  const directionFactor = (priceChange1h >= 0 ? 1 : 0.5); // Penalize negative momentum

  let score = 50 + (weightedChange * directionFactor * 0.5); // 50-100 range

  // Also consider volume trend if available
  const volumeChange1h = token.volume1hUsd ?? token.volume24hUsd ?? 0;
  const volumeChange24h = token.volume24hUsd ?? 0;
  if (volumeChange24h > 0) {
    const volumeRatio = Math.min(volumeChange1h / volumeChange24h, 2); // Cap at 2x
    const volumeScore = (volumeRatio - 1) * 25; // -25 to +25 points
    score += volumeScore;
  }

  // Clamp to 0-100
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Compute holder growth score (0-100) based on new holders per hour
 * Higher holder growth = higher score
 */
function computeHolderScore(holderGrowth: number | undefined): number {
  if (holderGrowth === undefined) return 50; // Neutral if unknown

  // Define holder growth thresholds for scoring
  const tiers = [
    { min: 50, score: 100 },    // High growth
    { min: 20, score: 80 },     // Good growth
    { min: 10, score: 60 },     // Moderate growth
    { min: 0, score: 40 },      // Low growth
    { min: -10, score: 20 },    // Declining
    { min: -100, score: 0 }     // Rapid decline
  ];

  for (const tier of tiers) {
    if (holderGrowth >= tier.min) {
      const nextTier = tiers.find(t => t.min < tier.min);
      if (!nextTier) return tier.score;

      const range = tier.min - nextTier.min;
      const scoreRange = tier.score - nextTier.score;
      const position = (holderGrowth - nextTier.min) / range;
      return Math.round(nextTier.score + position * scoreRange);
    }
  }

  return 0;
}

/**
 * Compute contract safety score (0-100) based on contract risk factors
 * Higher score = safer contract
 */
function computeContractSafetyScore(token: DegenToken): number {
  let score = 100; // Start with perfect score

  // Mint authority active is risky
  if (token.mintAuthorityActive === true) {
    score -= 20;
  }

  // Freeze authority active is risky
  if (token.freezeAuthorityActive === true) {
    score -= 20;
  }

  // Ownership not renounced is risky
  if (token.ownershipRenounced === false) {
    score -= 10;
  }

  // Contract not verified is risky
  if (token.contractVerified === false) {
    score -= 10;
  }

  // Liquidity not locked is risky
  if (token.liquidityLocked === false) {
    score -= 15;
  }

  // Honeypot risk reduces score significantly
  if (token.honeypotStatus === "honeypot-risk") {
    score -= 25;
  } else if (token.honeypotStatus === "suspicious") {
    score -= 10;
  }

  // High taxes are risky
  const buyTax = token.buyTaxPercent ?? 0;
  const sellTax = token.sellTaxPercent ?? 0;
  if (buyTax > 10 || sellTax > 10) {
    score -= 10;
  }

  // Holder concentration risk
  if (token.topHolderConcentration !== undefined && token.topHolderConcentration > 50) {
    score -= 15;
  } else if (token.topHolderConcentration !== undefined && token.topHolderConcentration > 30) {
    score -= 10;
  }

  // Ensure score is within bounds
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Compute social/community score (0-100) based on social presence
 * Higher social presence = higher score
 */
function computeSocialScore(token: DegenToken): number {
  if (token.socialLinks && Array.isArray(token.socialLinks) && token.socialLinks.length > 0) {
    // We have social links, score based on number and presence of known platforms
    const knownPlatforms = ["twitter", "telegram", "discord", "medium", "reddit"];
    let knownCount = 0;

    for (const link of token.socialLinks) {
      const lowerLink = link.toLowerCase();
      if (knownPlatforms.some(platform => lowerLink.includes(platform))) {
        knownCount++;
      }
    }

    // Score: 50 for having any social links, up to 100 for having multiple known platforms
    return Math.min(100, 50 + knownCount * 10);
  }

  return 0;
}

/**
 * Compute data confidence score (0-100) based on completeness of data
 * Higher score = more complete data
 */
function computeDataScore(token: DegenToken): number {
  const importantFields = [
    "priceUsd",
    "marketCapUsd",
    "liquidityUsd",
    "volume24hUsd",
    "buys24h",
    "sells24h",
    "tokenAgeMinutes",
    "holders",
    "holderGrowth",
    "socialLinks",
    "dexUrl",
    "websiteUrl",
    "logoUrl",
    "chartUrl",
    "explorerUrl"
  ];

  let definedCount = 0;
  for (const field of importantFields) {
    const value = (token as any)[field];
    if (value !== undefined && value !== null) {
      definedCount++;
    }
  }

  return Math.round((definedCount / importantFields.length) * 100);
}

/**
 * Main agent run function
 * Follows the same pattern as existing agents:
 * 1. Discover tokens from all sources
 * 2. Normalize and deduplicate
 * 3. Apply discovery rules (placeholder in Phase 2)
 * 4. Score and assess risk (now implemented in Phase 4)
 * 5. Send alerts for new tokens
 * 6. Mark all fetched tokens as seen
 */
export async function runDegenHunter(): Promise<void> {
  log(AGENT_KEY, "info", "Starting Degen Hunter scan...");

  const allTokens: DegenToken[] = [];

  // Fetch tokens from all sources
  for (const source of ALL_SOURCES) {
    try {
      const found = await source.fetch();
      log(AGENT_KEY, "info", `Source "${source.name}" returned ${found.length} tokens`);
      allTokens.push(...found);
    } catch (err) {
      const errorMessage = (err as Error).message;
      log(AGENT_KEY, "warn", `Source "${source.name}" failed: ${errorMessage}`);
      // Continue with other sources even if one fails
    }
  }

  if (allTokens.length === 0) {
    log(AGENT_KEY, "info", "No tokens fetched from any source");
    return;
  }

  // Deduplicate against everything we've ever seen for this agent
  // Using the existing @max/db SeenItem pattern (same as job-scout, etc.)
  const tokenIds = allTokens.map(t => t.contractAddress); // Using contract address as externalId
  const unseenIds = await filterUnseen(AGENT_KEY, tokenIds);
  const unseenTokens = allTokens.filter(t => unseenIds.includes(t.contractAddress));

  if (unseenTokens.length === 0) {
    log(AGENT_KEY, "info", `Checked ${ALL_SOURCES.length} sources, nothing new`);
    return;
  }

  // Apply discovery rules (placeholder in Phase 2)
  const filteredTokens = applyDiscoveryRules(unseenTokens);

  if (filteredTokens.length === 0) {
    log(AGENT_KEY, "info", `After filtering, zero tokens remain`);
    await markSeen(AGENT_KEY, unseenTokens.map(t => t.contractAddress));
    return;
  }

  // Process each token: populate risk data, score, assess risk, and prepare alerts
  const tokensWithRiskData = await Promise.all(filteredTokens.map(populateRiskData));

  const alertsToSend: { token: DegenToken; message: string }[] = [];

  for (const token of tokensWithRiskData) {
    // Compute and store scores (this will populate totalScore and component scores)
    const score = computeAndStoreScores(token);

    const alertMessage = generateTokenAlert(token);
    alertsToSend.push({ token, message: alertMessage });
    
    // Wire up global MAX alerts for the dashboard toast system
    import("../../lib/notifications").then(({ publishAlert }) => {
      // 1. New token alert
      publishAlert("degen-hunter", "new_token", `New Discovery: ${token.symbol} (${token.totalScore}/100)`, "info", { token });
      
      // 2. Risk alerts for extreme cases
      const flags = token.riskFlags ?? [];
      if (token.honeypotStatus === "honeypot-risk") {
        publishAlert("degen-hunter", "critical", `Honeypot Risk: ${token.symbol}`, "error", { token });
      } else if (flags.includes("extreme-risk") || (token.totalScore !== undefined && token.totalScore < 20)) {
        publishAlert("degen-hunter", "critical", `Extreme Risk: ${token.symbol}`, "error", { token });
      } else if (flags.includes("high-risk") || (token.totalScore !== undefined && token.totalScore < 45)) {
        publishAlert("degen-hunter", "risk_change", `High Risk Token: ${token.symbol}`, "warn", { token });
      }

      // 3. MAX bridge: send a deep-link alert via the MAX main bot
      const degenBotUsername = process.env.DEGEN_BOT_USERNAME || "MaxDegenHunterBot";
      const tokenId = token.id || token.contractAddress;
      const score = token.totalScore ?? 0;
      const maxBridgeMsg =
        `🔥 *Degen Hunter Alert*\n` +
        `*${token.name}* ($${token.symbol}) — Score: ${score}/100\n` +
        `Price: $${token.priceUsd?.toFixed(6) ?? "?"} | MC: $${token.marketCapUsd?.toLocaleString() ?? "?"}\n` +
        `Tap below to trade in Degen Hunter 👇`;
      notify(maxBridgeMsg, {
        reply_markup: {
          inline_keyboard: [[
            { text: "💰 Buy on Degen Hunter", url: `https://t.me/${degenBotUsername}?start=buy_${tokenId}` },
            { text: "👁 Watch", url: `https://t.me/${degenBotUsername}?start=watch_${tokenId}` },
          ]]
        }
      }).catch((err: Error) => log("degen-hunter", "warn", `MAX bridge notify failed: ${err.message}`));
    }).catch(console.error);
  }

  // Send alerts via dedicated Degen Hunter Telegram bot (Phase 5)
  if (alertsToSend.length > 0) {
    // Start the bot if not already started
    startBot();

    // Send each alert via Telegram
    for (const { token } of alertsToSend) {
      try {
        await sendTokenAlert(token);
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        log(AGENT_KEY, "error", `Failed to send alert for ${token.symbol}: ${(err as Error).message}`);
      }
    }

    log(AGENT_KEY, "info", `Sent ${alertsToSend.length} token alerts via Telegram`);
  }

  // Mark all fetched tokens as seen (matched or not) - same pattern as job-scout
  // This prevents re-alerting on the same tokens in future runs
  await markSeen(AGENT_KEY, unseenTokens.map(t => t.contractAddress));

  log(AGENT_KEY, "info",
    `Checked ${ALL_SOURCES.length} sources: ${allTokens.length} total tokens, ` +
    `${unseenTokens.length} new, ${filteredTokens.length} after filtering, ` +
    `${alertsToSend.length} alerts sent`
  );
}