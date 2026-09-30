import { runJobScout } from "./job-scout";
import { runAlphaScout } from "./alpha-scout";
import { runNftWhitelistHunter } from "./nft-whitelist";
import { runDegenHunter } from "./degen-hunter";

/**
 * Every runnable agent, keyed the same as its Agent.key in the DB. Shared by
 * the scheduler (both its normal cron interval and its manual-trigger poll)
 * and the CLI trigger script, so both paths always agree on what "running
 * job-scout" means — add a new agent here once and it's immediately
 * available to both.
 */
export const AGENT_RUNNERS: Record<string, () => Promise<void>> = {
  "job-scout": runJobScout,
  "alpha-scout": runAlphaScout,
  "wl-hunter": runNftWhitelistHunter,
  "degen-hunter": runDegenHunter,
};
