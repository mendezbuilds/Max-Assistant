import { AlphaSource, RawSignal } from "../types";

/**
 * - X/Twitter: same reasoning as job-scout's X stub — the search/filtered-
 *   stream endpoints needed to watch hashtags/accounts require a paid API
 *   tier the free tier doesn't cover.
 * - DappRadar: has an official API, but it's behind a signup-gated key
 *   (header X-DappRadar-API-Key) and its docs site (docs.dappradar.com)
 *   was unreachable from here (repeated DNS resolution failures) — unlike
 *   Web3.career/Covalent, I have neither a key nor accessible docs to test
 *   even a best-effort field mapping against, so guessing here would be
 *   pure speculation rather than an educated attempt. Needs you to get a
 *   key; I can verify it live the same way the other two were fixed once
 *   you have one.
 */
function stub(name: string, reason: string): AlphaSource {
  let warned = false;
  return {
    name,
    async fetch(): Promise<RawSignal[]> {
      if (!warned) {
        console.warn(`[alpha-scout] ${name} source not built: ${reason}`);
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

export const dappRadarSource = stub(
  "dappradar",
  "needs a signup-gated API key; docs.dappradar.com was unreachable to even guess a field mapping"
);
