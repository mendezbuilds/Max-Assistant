import { keccak256 } from "js-sha3";
import { AlphaSource, RawSignal } from "../types";
import { fetchWithRetry } from "../../../lib/http";

/**
 * Token/project launch signal via Covalent (GoldRush), reusing job-scout's
 * verified approach (see apps/core/src/agents/job-scout/sources/covalent.ts
 * for the full history of what was wrong with the first guess and how it
 * was fixed): watch each chain's Uniswap V3 factory for PoolCreated events,
 * then cross-check DexScreener for the compound signal from the spec
 * ("launch + active social presence") since Covalent has no notion of a
 * token's linked social/website.
 *
 * Extended here to 5 EVM chains (Solana is handled separately in
 * sources/solana.ts — Covalent's Solana offering only exposes this kind of
 * data via real-time streams, not a poll-friendly REST endpoint, so it
 * doesn't fit this cron-based architecture the way the EVM chains do).
 *
 * The factory address is NOT the same across every chain — verified live
 * against real GOLDRUSH_API_KEY responses (2026-09-13) rather than assumed:
 * Ethereum/Base/Arbitrum/Optimism/Polygon all share the same CREATE2
 * address (confirmed real PoolCreated events on each), but BNB Chain's
 * Uniswap v3 deployment came later via separate governance and uses a
 * different address — using the "universal" one there silently finds
 * nothing, which is exactly the kind of wrong-but-quiet bug worth flagging.
 */

const POOL_CREATED_SIGNATURE = "PoolCreated(address,address,uint24,int24,address)";
const POOL_CREATED_TOPIC0 = "0x" + keccak256(POOL_CREATED_SIGNATURE);

const UNIVERSAL_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

// blockLookback is deliberately generous — see the matching comment in
// job-scout's covalent.ts for why (Covalent bills per call, not per block
// scanned; SeenItem dedup makes overlap harmless; too small a window on a
// chain faster than assumed would silently miss real launches).
const CHAINS: Array<{
  covalentName: string;
  dexScreenerId: string;
  label: string;
  factory: string;
  blockLookback: number;
}> = [
  { covalentName: "eth-mainnet", dexScreenerId: "ethereum", label: "Ethereum", factory: UNIVERSAL_V3_FACTORY, blockLookback: 300 },
  { covalentName: "base-mainnet", dexScreenerId: "base", label: "Base", factory: UNIVERSAL_V3_FACTORY, blockLookback: 3600 },
  { covalentName: "arbitrum-mainnet", dexScreenerId: "arbitrum", label: "Arbitrum", factory: UNIVERSAL_V3_FACTORY, blockLookback: 14_400 },
  { covalentName: "optimism-mainnet", dexScreenerId: "optimism", label: "Optimism", factory: UNIVERSAL_V3_FACTORY, blockLookback: 3600 },
  { covalentName: "matic-mainnet", dexScreenerId: "polygon", label: "Polygon", factory: UNIVERSAL_V3_FACTORY, blockLookback: 3600 },
  { covalentName: "bsc-mainnet", dexScreenerId: "bsc", label: "BNB Chain", factory: "0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7", blockLookback: 3600 },
];

interface CovalentLogEvent {
  block_signed_at?: string;
  tx_hash?: string;
  log_offset?: number;
  raw_log_topics?: string[];
  decoded?: { params?: Array<{ name: string; value: string }> };
}

interface DexScreenerPair {
  info?: { websites?: unknown[]; socials?: unknown[] };
}

function getApiKey(): string | undefined {
  return process.env.GOLDRUSH_API_KEY ?? process.env.COVALENT_API_KEY;
}

async function getTipHeight(covalentName: string, apiKey: string): Promise<number> {
  const res = await fetchWithRetry(`https://api.covalenthq.com/v1/${covalentName}/block_v2/latest/`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Covalent block_v2/latest (${covalentName}) returned ${res.status}: ${body.slice(0, 300)}`);
  }
  const body = (await res.json()) as { data?: { chain_tip_height?: number } };
  const height = body.data?.chain_tip_height;
  if (!height) throw new Error(`Covalent block_v2/latest (${covalentName}) returned no chain_tip_height`);
  return height;
}

async function fetchNewPools(chain: (typeof CHAINS)[number], apiKey: string): Promise<CovalentLogEvent[]> {
  const tip = await getTipHeight(chain.covalentName, apiKey);
  const startingBlock = Math.max(0, tip - chain.blockLookback);

  const url =
    `https://api.covalenthq.com/v1/${chain.covalentName}/events/topics/${POOL_CREATED_TOPIC0}/` +
    `?sender-address=${chain.factory}&starting-block=${startingBlock}&ending-block=latest`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Covalent events API (${chain.covalentName}) returned ${res.status}: ${body.slice(0, 300)}`);
  }

  const body = (await res.json()) as { data?: { items?: CovalentLogEvent[] } };
  return (body.data?.items ?? []).filter(
    (item) => item.raw_log_topics?.[0]?.toLowerCase() === POOL_CREATED_TOPIC0
  );
}

async function hasSocialPresence(dexScreenerId: string, poolAddress: string): Promise<boolean> {
  try {
    const res = await fetchWithRetry(
      `https://api.dexscreener.com/latest/dex/pairs/${dexScreenerId}/${poolAddress}`,
      { retries: 1 }
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { pairs?: DexScreenerPair[] };
    const pair = body.pairs?.[0];
    return Boolean(pair?.info?.websites?.length || pair?.info?.socials?.length);
  } catch {
    return false;
  }
}

export const covalentSource: AlphaSource = {
  name: "covalent",

  async fetch(): Promise<RawSignal[]> {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.warn("[alpha-scout] covalent source not configured: set GOLDRUSH_API_KEY in .env");
      return [];
    }

    const signals: RawSignal[] = [];

    for (const chain of CHAINS) {
      let events: CovalentLogEvent[];
      try {
        events = await fetchNewPools(chain, apiKey);
      } catch (err) {
        console.warn(`[alpha-scout] covalent: ${chain.label} fetch failed: ${(err as Error).message}`);
        continue;
      }

      for (const event of events) {
        const params = event.decoded?.params ?? [];
        const token0 = params.find((p) => p.name === "token0")?.value;
        const token1 = params.find((p) => p.name === "token1")?.value;
        const pool = params.find((p) => p.name === "pool")?.value;
        if (!pool || !event.tx_hash) continue;

        if (!(await hasSocialPresence(chain.dexScreenerId, pool))) continue;

        signals.push({
          externalId: `covalent:${chain.covalentName}:${event.tx_hash}:${event.log_offset ?? 0}`,
          source: `Covalent (${chain.label})`,
          kind: "token-launch",
          chain: chain.label,
          title: `New token pair launched on ${chain.label}`,
          summary: `Uniswap V3 pool created for ${token0 ?? "?"} / ${token1 ?? "?"}, with a linked social/website presence.`,
          url: `https://dexscreener.com/${chain.dexScreenerId}/${pool}`,
          foundAt: new Date(),
        });
      }
    }

    return signals;
  },
};
