import { filterUnseen, markSeen } from "@max/db";
import { log } from "../../logger";
import { notify } from "../../telegram";
import { recordSourceResult } from "../../lib/source-health";
import { formatLead } from "./format";
import { xSource, nftTrackingSiteSource } from "./sources/stubs";
import { NftSource, RawNftLead } from "./types";

const AGENT_KEY = "wl-hunter"; // matches the roster's Agent.key (packages/shared/src/agents.config.ts) — the "nft-whitelist" name is just this module's folder/npm-script naming

// Add a new source by implementing NftSource and listing it here.
const ALL_SOURCES: NftSource[] = [xSource, nftTrackingSiteSource];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runNftWhitelistHunter(): Promise<void> {
  const raw: RawNftLead[] = [];

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
    await log(AGENT_KEY, "info", "No leads fetched this run (all sources empty or failing)");
    return;
  }

  const unseenIds = await filterUnseen(AGENT_KEY, raw.map((r) => r.externalId));
  const unseen = raw.filter((r) => unseenIds.includes(r.externalId));

  if (unseen.length === 0) {
    await log(AGENT_KEY, "info", `Checked ${ALL_SOURCES.length} sources, nothing new`);
    return;
  }

  // No quality filter, per spec — every lead found gets surfaced regardless
  // of project size or social proof; Mendez judges each individually.
  // Private feed only for now, consistent with alpha-scout's current setup.
  for (const lead of unseen) {
    await notify(formatLead(lead));
    await sleep(500); // stay well under Telegram's per-chat flood limits
  }

  await markSeen(AGENT_KEY, unseen.map((r) => r.externalId));

  await log(AGENT_KEY, "info", `Checked ${ALL_SOURCES.length} sources: ${unseen.length} new lead(s) sent`);
}
