import { filterUnseen, markSeen } from "@max/db";
import { log } from "../../logger";
import { notify, notifyPublic } from "../../telegram";
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

export async function runJobScout(): Promise<void> {
  const raw: RawListing[] = [];

  for (const source of ALL_SOURCES) {
    try {
      raw.push(...(await source.fetch()));
    } catch (err) {
      await log(AGENT_KEY, "warn", `Source "${source.name}" failed: ${(err as Error).message}`);
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
    const privateMatch = applyFilters(listing, PRIVATE_FEED_OPTIONS);
    if (privateMatch) privateMatches.push(privateMatch);

    const publicMatch = applyFilters(listing, PUBLIC_FEED_OPTIONS);
    if (publicMatch) publicMatches.push(publicMatch);
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
