import { JobSource, RawListing } from "../types";

/**
 * These three sources from the spec aren't implemented yet — each needs a
 * decision from Mendez before they safely can be:
 *
 * - X/Twitter: the search/filtered-stream endpoints needed to watch
 *   hashtags/accounts require a paid API tier (the free tier doesn't cover
 *   search). Needs a decision on budget + an API key before this is wired up.
 * - LinkedIn: has no public API for this, and scraping it violates their ToS
 *   (and risks the account it runs from getting banned) — this is *not*
 *   something to build without an explicit "yes, do this anyway" decision,
 *   given the risk. Recommend waiting for an official partner API angle, or
 *   manual watch for now.
 * - DEX/on-chain: needs a specific data provider chosen (e.g. DexScreener,
 *   Birdeye) and a definition of what "new launch" should trigger + how to
 *   turn a bare token launch into a role/company signal worth alerting on.
 *
 * Each still implements the JobSource interface and is wired into
 * ALL_SOURCES in index.ts, so turning one on later is just replacing its
 * fetch() body — no changes needed anywhere else in the pipeline.
 */
function stub(name: string, reason: string): JobSource {
  let warned = false;
  return {
    name,
    async fetch(): Promise<RawListing[]> {
      if (!warned) {
        console.warn(`[job-scout] ${name} source not configured yet: ${reason}`);
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

export const linkedInSource = stub(
  "linkedin",
  "no public API; scraping would violate LinkedIn's ToS — needs an explicit decision before building"
);

export const dexScreenerSource = stub(
  "dexscreener",
  "needs a chosen on-chain data provider + a rule for what counts as a hiring signal"
);
