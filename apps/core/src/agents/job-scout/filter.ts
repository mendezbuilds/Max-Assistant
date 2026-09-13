import { mentionsUnpaid } from "./pay";
import {
  MatchedListing,
  PAY_FLOOR_EXEMPT_CATEGORIES,
  RawListing,
  RoleCategory,
} from "./types";

/**
 * Role keywords from the spec, roughly ordered most-specific-first so e.g. a
 * "co-founder" posting doesn't get classified as generic "management" just
 * because it also says "manage the team". First match wins.
 */
const ROLE_KEYWORDS: Array<[RoleCategory, RegExp]> = [
  ["co-founder", /\bco-?founder\b/i],
  ["ambassador", /\bambassador\b/i],
  ["partnerships", /\b(partnerships?|biz(?:iness)?\s?dev(?:elopment)?|bd\s?lead)\b/i],
  ["video-editor", /\bvideo\s?edit(?:or|ing)\b/i],
  ["community-manager", /\bcommunity\s?(manager|mod(?:erator)?)\b/i],
  ["management-strategist", /\b(strategist|head\s+of|director|program\s+manager|product\s+manager)\b/i],
  ["full-stack-dev", /\b(full[\s-]?stack|frontend|front-end|backend|back-end|software\s+engineer|developer|dev\b)\b/i],
];

/**
 * Classifies against the title + source tags only — deliberately NOT the
 * full description. A first pass matched against the whole description text
 * turned out to match almost everything (a generic word like "developer" or
 * "dev" shows up somewhere in most job descriptions even for unrelated
 * roles, e.g. an HR posting mentioning "our developer community"). The
 * title is what the poster chose to call the role, which is a far more
 * reliable signal than words appearing anywhere in a page of prose.
 */
function classifyRole(raw: Pick<RawListing, "title" | "tags">): RoleCategory | undefined {
  const text = [raw.title, ...(raw.tags ?? [])].join(" ");
  for (const [category, pattern] of ROLE_KEYWORDS) {
    if (pattern.test(text)) return category;
  }
  return undefined;
}

function isRemote(searchText: string): boolean {
  // Both current sources (RemoteOK, WeWorkRemotely) are remote-only boards by
  // construction, but this guards future non-remote-focused sources too.
  return /\bremote\b/i.test(searchText);
}

export interface FilterOptions {
  /** Minimum hourly-equivalent USD to include a wage-based listing. */
  minHourlyUsd: number;
  /** Below this, still included, but not flagged high-priority. */
  highPriorityHourlyUsd: number;
}

export const PRIVATE_FEED_OPTIONS: FilterOptions = {
  minHourlyUsd: 10,
  highPriorityHourlyUsd: 15,
};

// Public/growth-channel feed: same "no unpaid roles" rule, but no wage floor
// beyond that — the goal there is volume/reach, not a strict personal match.
// (SPEC.md says "broader/looser pay floor for wider appeal" without a number;
// this is Max's judgment call on what "looser" means — tune freely.)
export const PUBLIC_FEED_OPTIONS: FilterOptions = {
  minHourlyUsd: 0,
  highPriorityHourlyUsd: 15,
};

/**
 * Applies the spec's filter criteria to one raw listing. Returns undefined if
 * it should be dropped, otherwise the listing enriched with role category +
 * priority.
 */
export function applyFilters(raw: RawListing, options: FilterOptions): MatchedListing | undefined {
  if (!isRemote(raw.searchText)) return undefined;

  const roleCategory = classifyRole(raw);
  if (!roleCategory) return undefined; // doesn't match any role we're watching for

  const payExempt = PAY_FLOOR_EXEMPT_CATEGORIES.has(roleCategory);

  // "Exclude unpaid roles" — equity-based roles are explicitly accepted per
  // spec, so this only fires on an explicit volunteer/no-compensation
  // signal, never merely on "no salary number was posted".
  if (!payExempt && mentionsUnpaid(raw.searchText)) return undefined;

  if (payExempt) {
    // Co-founder/ambassador/partnership leads: spec says the pay floor
    // doesn't apply cleanly here — always keep, standard priority.
    return { ...raw, roleCategory, priority: "standard" };
  }

  if (raw.hourlyUsd === undefined) {
    // Pay not listed/parseable — can't confirm it clears the floor, but we
    // also can't confirm it doesn't. Keep it rather than silently dropping a
    // possible match; format.ts will show pay as "not listed".
    return { ...raw, roleCategory, priority: "standard" };
  }

  if (raw.hourlyUsd < options.minHourlyUsd) return undefined;

  const priority = raw.hourlyUsd >= options.highPriorityHourlyUsd ? "high" : "standard";
  return { ...raw, roleCategory, priority };
}
