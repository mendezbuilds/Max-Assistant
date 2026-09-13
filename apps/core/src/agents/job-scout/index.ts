import { filterUnseen, markSeen } from "@max/db";
import { log } from "../../logger";
import { notify, notifyPublic } from "../../telegram";
import { recordSourceResult } from "../../lib/source-health";
import { applyFilters, PRIVATE_FEED_OPTIONS, PUBLIC_FEED_OPTIONS } from "./filter";
import { formatListing } from "./format";
import { remoteOkSource } from "./sources/remoteok";
import { weWorkRemotelySource } from "./sources/weworkremotely";
import { cryptoJobsListSource } from "./sources/cryptojobslist";
import { workingNomadsSource } from "./sources/workingnomads";
import { web3CareerSource } from "./sources/web3career";
import { mercorSource } from "./sources/mercor";
import { covalentSource } from "./sources/covalent";
import {
  xSource,
  linkedInSource,
  wellfoundSource,
  turingSource,
  micro1Source,
} from "./sources/stubs";
import { JobSource, MatchedListing, RawListing } from "./types";

const AGENT_KEY = "job-scout";

// Add a new source by implementing JobSource and listing it here — nothing
// else in this pipeline needs to change.
const ALL_SOURCES: JobSource[] = [
  remoteOkSource,
  weWorkRemotelySource,
  cryptoJobsListSource,
  workingNomadsSource,
  web3CareerSource,
  mercorSource,
  covalentSource,
  xSource,
  linkedInSource,
  wellfoundSource,
  turingSource,
  micro1Source,
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sends one listing per message, paced to stay well under Telegram's per-chat flood limits (matters most on the very first run, when everything is "new"). */
async function sendPaced(send: (text: string) => Promise<void>, listings: MatchedListing[]) {
  for (const listing of listings) {
    await send(formatListing(listing));
    await sleep(500);
  }
}

/**
 * Per-listing filter reasoning — console only, deliberately not the shared
 * ActivityLog/dashboard feed. Logging one line per checked listing there
 * (routinely 50-150+ per run) would (a) flood the feed other agents'
 * activity shares, and (b) since logActivity() updates the agent's own
 * lastActionAt as a side effect, the *last* debug line logged would become
 * the card's "last action" instead of the actual run summary — the same
 * trap the manual-trigger work hit and worked around. This is for "why did
 * X pass/fail" debugging, not user-facing activity, so console (visible in
 * the core process's own output) is where it belongs.
 */
function logDecision(title: string, source: string, verdict: string) {
  console.log(`[job-scout] ${verdict} :: "${title}" (${source})`);
}

export async function runJobScout(): Promise<void> {
  const raw: RawListing[] = [];

  for (const source of ALL_SOURCES) {
    try {
      const found = await source.fetch();
      raw.push(...found);
      recordSourceResult(AGENT_KEY, source.name, { ok: true });
    } catch (err) {
      const errorMessage = (err as Error).message;
      const status = recordSourceResult(AGENT_KEY, source.name, { ok: false, errorMessage });

      if (status === "degraded") {
        await log(
          AGENT_KEY,
          "error",
          `⚠️ Source "${source.name}" DEGRADED — failing repeatedly across runs. Latest: ${errorMessage}`
        );
      } else {
        await log(AGENT_KEY, "warn", `Source "${source.name}" failed: ${errorMessage}`);
      }
    }
  }

  if (raw.length === 0) {
    await log(AGENT_KEY, "info", "No listings fetched this run (all sources empty or failing)");
    return;
  }

  // Dedup against everything we've ever fetched, not just what we alerted on
  // — a non-matching listing won't suddenly start matching later just
  // because we re-check it, so there's no value in re-fetching its content.
  const unseenIds = await filterUnseen(AGENT_KEY, raw.map((r) => r.externalId));
  const unseen = raw.filter((r) => unseenIds.includes(r.externalId));

  if (unseen.length === 0) {
    await log(AGENT_KEY, "info", `Checked ${ALL_SOURCES.length} sources, nothing new`);
    return;
  }

  const privateMatches: MatchedListing[] = [];
  const publicMatches: MatchedListing[] = [];
  for (const listing of unseen) {
    const privateResult = applyFilters(listing, PRIVATE_FEED_OPTIONS);
    const publicResult = applyFilters(listing, PUBLIC_FEED_OPTIONS);

    if (privateResult.outcome === "pass") privateMatches.push(privateResult.listing);
    if (publicResult.outcome === "pass") publicMatches.push(publicResult.listing);

    if (privateResult.outcome === "pass" || publicResult.outcome === "pass") {
      const feeds = [
        privateResult.outcome === "pass" && "private",
        publicResult.outcome === "pass" && "public",
      ]
        .filter(Boolean)
        .join("+");
      logDecision(listing.title, listing.source, `PASS → ${feeds}`);
    } else {
      // Both feeds rejected — usually for the same reason, but not always
      // (the public feed has no pay floor), so show both when they differ.
      const reason =
        privateResult.reason === publicResult.reason
          ? privateResult.reason
          : `private: ${privateResult.reason}; public: ${publicResult.reason}`;
      logDecision(listing.title, listing.source, `REJECT (${reason})`);
    }
  }

  await sendPaced(notify, privateMatches);
  await sendPaced(notifyPublic, publicMatches);

  // Mark everything fetched this run as seen, matched or not — see the
  // dedup comment above for why non-matches are included too.
  await markSeen(AGENT_KEY, unseen.map((r) => r.externalId));

  await log(
    AGENT_KEY,
    "info",
    `Checked ${ALL_SOURCES.length} sources: ${unseen.length} new, ` +
      `${privateMatches.length} private match(es), ${publicMatches.length} public match(es)`
  );
}
