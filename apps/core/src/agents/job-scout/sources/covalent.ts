import { keccak256 } from "js-sha3";
import { JobSource, RawListing } from "../types";

/**
 * DEX/on-chain hiring signal, per addendum: Covalent (rebranded "GoldRush")
 * as the data provider, watching for new token/project launches on Base,
 * Ethereum, Arbitrum, and Optimism. Set GOLDRUSH_API_KEY (or the older
 * COVALENT_API_KEY name) in .env to enable — behaves like the other
 * not-configured sources until then.
 *
 * ⚠️ Highest-uncertainty source in this file — flagging clearly rather than
 * quietly hoping it's right:
 * - I don't have a live API key to test against, so the exact response
 *   envelope/field names below (see CovalentLogEvent) are based on
 *   Covalent's documented "decoded log event" shape used elsewhere in their
 *   API, not a verified response from this specific endpoint. If this logs
 *   "0 events" repeatedly with a real key set, that's the first thing to
 *   check against an actual response.
 * - "New launch" here = a new Uniswap V3 pool creation. The factory
 *   contract address (below) is the same across all four chains because
 *   Uniswap deploys it via CREATE2 with the same salt on every chain — a
 *   well-established fact, not something this code discovers at runtime.
 *   The event's topic0 hash, however, is *computed* from the human-readable
 *   event signature via keccak256 rather than pasted as a hex literal —
 *   hand-copying a 32-byte hash from memory is exactly the kind of thing
 *   that's silently wrong in a way that just yields zero matches forever.
 * - Covalent has no notion of a token's linked social/website presence —
 *   that compound condition from the spec ("also has an active social
 *   presence") is checked via a secondary, unauthenticated lookup against
 *   DexScreener's public API instead. Covalent remains the actual launch
 *   *detector*, per the addendum; DexScreener only fills the one gap
 *   Covalent can't.
 * - Raw "new pool created" events are extremely high-volume and mostly
 *   noise (rug pulls, dust, arbitrage bots) — the DexScreener social-link
 *   check is doing real filtering work here, not just enrichment. Don't
 *   remove it without replacing it with something else that cuts the noise.
 */

const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const POOL_CREATED_SIGNATURE = "PoolCreated(address,address,uint24,int24,address)";
const POOL_CREATED_TOPIC0 = "0x" + keccak256(POOL_CREATED_SIGNATURE);

const CHAINS: Array<{ covalentName: string; dexScreenerId: string; label: string }> = [
  { covalentName: "eth-mainnet", dexScreenerId: "ethereum", label: "Ethereum" },
  { covalentName: "base-mainnet", dexScreenerId: "base", label: "Base" },
  { covalentName: "arbitrum-mainnet", dexScreenerId: "arbitrum", label: "Arbitrum" },
  { covalentName: "optimism-mainnet", dexScreenerId: "optimism", label: "Optimism" },
];

interface CovalentLogEvent {
  block_signed_at?: string;
  tx_hash?: string;
  log_offset?: number;
  raw_log_topics?: string[];
  decoded?: {
    name?: string;
    params?: Array<{ name: string; value: string }>;
  };
}

interface DexScreenerPair {
  pairCreatedAt?: number;
  url?: string;
  baseToken?: { address?: string; symbol?: string };
  info?: { websites?: unknown[]; socials?: unknown[] };
}

function getApiKey(): string | undefined {
  return process.env.GOLDRUSH_API_KEY ?? process.env.COVALENT_API_KEY;
}

async function fetchNewPools(chain: { covalentName: string }, apiKey: string): Promise<CovalentLogEvent[]> {
  const url = `https://api.covalenthq.com/v1/${chain.covalentName}/events/address/${UNISWAP_V3_FACTORY}/`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Covalent events API (${chain.covalentName}) returned ${res.status}`);
  }

  const body = (await res.json()) as { data?: { items?: CovalentLogEvent[] } };
  const items = body.data?.items ?? [];

  return items.filter((item) => item.raw_log_topics?.[0]?.toLowerCase() === POOL_CREATED_TOPIC0);
}

/** Best-effort: does DexScreener show this pair as having a linked website/social? Returns false (not undefined) on any failure — "unconfirmed" and "no" are treated the same, since this check exists specifically to cut noise. */
async function hasSocialPresence(dexScreenerId: string, poolAddress: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${dexScreenerId}/${poolAddress}`);
    if (!res.ok) return false;
    const body = (await res.json()) as { pairs?: DexScreenerPair[] };
    const pair = body.pairs?.[0];
    return Boolean(pair?.info?.websites?.length || pair?.info?.socials?.length);
  } catch {
    return false;
  }
}

export const covalentSource: JobSource = {
  name: "covalent",

  async fetch(): Promise<RawListing[]> {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.warn(
        "[job-scout] covalent source not configured: set GOLDRUSH_API_KEY in .env " +
          "(the same key already used for ChainTale should work)"
      );
      return [];
    }

    const listings: RawListing[] = [];

    for (const chain of CHAINS) {
      let events: CovalentLogEvent[];
      try {
        events = await fetchNewPools(chain, apiKey);
      } catch (err) {
        console.warn(`[job-scout] covalent: ${chain.label} fetch failed: ${(err as Error).message}`);
        continue;
      }

      for (const event of events) {
        const params = event.decoded?.params ?? [];
        const token0 = params.find((p) => p.name === "token0")?.value;
        const token1 = params.find((p) => p.name === "token1")?.value;
        const pool = params.find((p) => p.name === "pool")?.value;
        if (!pool || !event.tx_hash) continue;

        const social = await hasSocialPresence(chain.dexScreenerId, pool);
        if (!social) continue; // the compound signal from the spec: launch AND an active social presence

        listings.push({
          externalId: `covalent:${chain.covalentName}:${event.tx_hash}:${event.log_offset ?? 0}`,
          source: `Covalent (${chain.label})`,
          kind: "lead", // no formal job listing exists — this is a hiring-team signal, not a posting
          posterUsername: "on-chain",
          title: `New token pair launched on ${chain.label}`,
          summary: `Uniswap V3 pool created for ${token0 ?? "?"} / ${token1 ?? "?"}. An active hiring team behind a fresh launch is often an early opportunity before any formal listing exists.`,
          url: `https://dexscreener.com/${chain.dexScreenerId}/${pool}`,
          postedAt: event.block_signed_at ? new Date(event.block_signed_at) : new Date(),
          remote: true, // on-chain teams are remote by default; no posting to check
          forcedRoleCategory: "on-chain-lead",
          searchText: `${token0 ?? ""} ${token1 ?? ""}`,
        });
      }
    }

    return listings;
  },
};
