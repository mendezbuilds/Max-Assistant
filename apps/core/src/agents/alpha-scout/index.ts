import { filterUnseen, markSeen } from "@max/db";
import { log } from "../../logger";
import { notify } from "../../telegram";
import { recordSourceResult } from "../../lib/source-health";
import { formatSignal } from "./format";
import { covalentSource } from "./sources/covalent";
import { solanaSource } from "./sources/solana";
import { airdropsIoSource } from "./sources/airdropsio";
import { xSource, dappRadarSource } from "./sources/stubs";
import { AlphaSource, RawSignal } from "./types";

const AGENT_KEY = "alpha-scout";

// Add a new source by implementing AlphaSource and listing it here.
const ALL_SOURCES: AlphaSource[] = [covalentSource, solanaSource, airdropsIoSource, xSource, dappRadarSource];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAlphaScout(): Promise<void> {
  const raw: RawSignal[] = [];

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
    await log(AGENT_KEY, "info", "No signals fetched this run (all sources empty or failing)");
    return;
  }

  const unseenIds = await filterUnseen(AGENT_KEY, raw.map((r) => r.externalId));
  const unseen = raw.filter((r) => unseenIds.includes(r.externalId));

  if (unseen.length === 0) {
    await log(AGENT_KEY, "info", `Checked ${ALL_SOURCES.length} sources, nothing new`);
    return;
  }

  // Private feed only for now, per spec — no role/pay filtering either
  // (nothing in the spec calls for it here), so every unseen signal sends.
  for (const signal of unseen) {
    await notify(formatSignal(signal));
    await sleep(500); // stay well under Telegram's per-chat flood limits
  }

  await markSeen(AGENT_KEY, unseen.map((r) => r.externalId));

  await log(AGENT_KEY, "info", `Checked ${ALL_SOURCES.length} sources: ${unseen.length} new signal(s) sent`);
}
