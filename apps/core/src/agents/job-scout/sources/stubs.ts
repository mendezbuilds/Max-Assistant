import { JobSource, RawListing } from "../types";

/**
 * Sources deliberately not built — each needs a decision from Mendez, or
 * simply has no automatable data to read, before it's safe/possible to
 * build for real:
 *
 * - X/Twitter: the search/filtered-stream endpoints needed to watch
 *   hashtags/accounts require a paid API tier (the free tier doesn't cover
 *   search). Revisit once free sources (job boards + on-chain) prove
 *   insufficient on their own (per addendum).
 * - LinkedIn: has no public API for this, and scraping it violates their ToS
 *   (and risks the account it runs from getting banned) — skipped for v1
 *   per addendum. Left stubbed for reconsideration if a compliant method
 *   (e.g. official Jobs API access) ever exists.
 * - Wellfound (AngelList): checked — no public API or RSS exists; the only
 *   programmatic access found is paid third-party scrapers (Apify) built
 *   against their HTML, which carries the same ToS/fragility risk profile
 *   as LinkedIn. Not built without an explicit go-ahead given that risk —
 *   flagging rather than assuming, same as LinkedIn.
 * - Turing / micro1: checked both — neither has discrete job listings at
 *   all. Both are "create a profile, get matched later" application funnels
 *   (Turing: developers.turing.com/signup; micro1: talent.micro1.ai/login) —
 *   there's nothing here to poll or de-dup against. (Mercor, the third
 *   AI-training platform from the same addendum, *does* have real listings
 *   — see sources/mercor.ts.) If Mendez isn't already signed up to either,
 *   that's a one-time manual action, not something to automate.
 *
 * Each still implements the JobSource interface and is wired into
 * ALL_SOURCES in index.ts, so replacing a stub later is just replacing its
 * fetch() body — no changes needed anywhere else in the pipeline.
 */
function stub(name: string, reason: string): JobSource {
  let warned = false;
  return {
    name,
    async fetch(): Promise<RawListing[]> {
      if (!warned) {
        console.warn(`[job-scout] ${name} source not built: ${reason}`);
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
  "no public API; scraping would violate LinkedIn's ToS — skipped per addendum"
);

export const wellfoundSource = stub(
  "wellfound",
  "no public API/RSS; only paid third-party HTML scrapers exist, same ToS/fragility risk as LinkedIn"
);

export const turingSource = stub(
  "turing",
  "no discrete listings — pure application funnel (developers.turing.com/signup); nothing to poll"
);

export const micro1Source = stub(
  "micro1",
  "no discrete listings — pure application funnel (talent.micro1.ai/login); nothing to poll"
);
