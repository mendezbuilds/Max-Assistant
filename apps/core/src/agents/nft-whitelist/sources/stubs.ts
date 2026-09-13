import { NftSource, RawNftLead } from "../types";

/**
 * Neither source category has a real, immediately-usable feed right now —
 * checked four dedicated NFT-launch tracking sites specifically (per the
 * spec's instruction to verify before committing, same standard as
 * Web3.career/Covalent/airdrops.io earlier) and none worked out:
 *
 * - **nftcalendar.io** — the actual events/drops page is behind Cloudflare's
 *   bot challenge ("Just a moment..."); nothing short of a real headless
 *   browser gets past it, which is a much bigger architecture change than
 *   this one source justifies on its own.
 * - **PREMINT** — has a real, documented API, but it's per-project
 *   (`api.premint.xyz/v1/<project_key>/`, for a project owner to manage
 *   their own list) — there's no "list all currently active campaigns"
 *   discovery endpoint, which is the shape this agent actually needs.
 * - **nftevening.com** — genuinely the best candidate: a real, free,
 *   official WordPress REST API (`/wp-json/wp/v2/event`) with clean
 *   structured fields (blockchain, status, category via `class_list`).
 *   The catch, caught by checking *freshness* rather than just structure:
 *   its most recent "event" (NFT drop) entry is from September 2024, and
 *   even its informal "NFT Drops This Week" blog roundup series stopped
 *   around March 2026. The API works; the content behind it has gone
 *   dormant. Shipping this would have looked done while silently
 *   returning nothing, forever — worse than not building it.
 * - **Alphabot** — the platform that best matches the spec's own language
 *   ("follow/RT/Discord to earn a WL spot" is literally what it does), and
 *   has a real, documented API — but reading raffle data requires "an
 *   active subscription" per its own docs, i.e. paid.
 *
 * X/Twitter: same reasoning as job-scout/alpha-scout — the endpoints
 * needed to watch hashtags/accounts require a paid API tier.
 *
 * Net effect: this agent currently has zero live sources. Everything else
 * (scheduler wiring, manual trigger, message format, verification-status
 * logic) is fully built and ready — replacing a stub's fetch() body is all
 * a real source needs once one exists (a paid Alphabot/DappRadar-style key,
 * a different site to check, or X API budget).
 */
function stub(name: string, reason: string): NftSource {
  let warned = false;
  return {
    name,
    async fetch(): Promise<RawNftLead[]> {
      if (!warned) {
        console.warn(`[nft-whitelist] ${name} source not built: ${reason}`);
        warned = true;
      }
      return [];
    },
  };
}

export const xSource = stub(
  "x",
  "needs a paid X API tier + API key for search/filtered-stream endpoints"
);

export const nftTrackingSiteSource = stub(
  "nft-tracking-site",
  "checked nftcalendar.io (Cloudflare-blocked), PREMINT (per-project API only, no discovery endpoint), " +
    "nftevening.com (real API, but content dormant since ~2024), Alphabot (paid subscription required) — " +
    "none usable as-is; needs either a paid key or a different site to check"
);
