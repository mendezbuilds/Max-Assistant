import { AlphaSource, RawSignal } from "../types";
import { fetchWithRetry } from "../../../lib/http";

/**
 * Solana token-launch signal. Deliberately NOT built on Covalent like the
 * EVM chains (see sources/covalent.ts) — Covalent's Solana offering only
 * exposes new-pool/DEX-firehose data via real-time streams (WebSocket-style,
 * for Raydium/Orca/Meteora/Jupiter/PumpFun), not a poll-friendly REST
 * endpoint. Building a persistent stream consumer doesn't fit this agent's
 * cron-poll architecture (a 30-min timer, not a long-lived listener) without
 * a much bigger structural change than this one source justifies.
 *
 * Instead this uses DexScreener's token-profiles feed alone, as both
 * detector and social-check in one call — it already returns recently
 * submitted token profiles including their linked website/social links,
 * which happens to satisfy the spec's compound signal (launch + active
 * social presence) directly for whatever it returns, without needing a
 * separate on-chain detection step. Filtered to Solana entries only; the
 * EVM chains keep using Covalent as their primary detector per the addendum.
 */
const API_URL = "https://api.dexscreener.com/token-profiles/latest/v1";

interface DexScreenerProfile {
  chainId?: string;
  tokenAddress?: string;
  url?: string;
  description?: string;
  links?: Array<{ type?: string; label?: string; url?: string }>;
}

export const solanaSource: AlphaSource = {
  name: "solana",

  async fetch(): Promise<RawSignal[]> {
    const res = await fetchWithRetry(API_URL);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`DexScreener token-profiles API returned ${res.status}: ${body.slice(0, 300)}`);
    }

    const profiles = (await res.json()) as DexScreenerProfile[];
    if (!Array.isArray(profiles)) return [];

    return profiles
      .filter((p) => p.chainId === "solana" && p.tokenAddress && (p.links?.length ?? 0) > 0)
      .map((p): RawSignal => {
        const social = p.links!.find((l) => l.type && l.type !== "website");
        const website = p.links!.find((l) => l.label === "Website" || l.type === "website");

        return {
          externalId: `solana-dexscreener:${p.tokenAddress}`,
          source: "DexScreener (Solana)",
          kind: "token-launch",
          chain: "Solana",
          title: `New Solana token profile: ${p.tokenAddress!.slice(0, 8)}…`,
          summary:
            (p.description ?? "No description provided.") +
            (social ? ` Linked ${social.type}: ${social.url}` : "") +
            (website ? ` Website: ${website.url}` : ""),
          url: p.url ?? `https://dexscreener.com/solana/${p.tokenAddress}`,
          foundAt: new Date(),
        };
      });
  },
};
