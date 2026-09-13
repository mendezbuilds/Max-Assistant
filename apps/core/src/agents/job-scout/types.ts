/** One role/lead a source found, before filtering. */
export interface RawListing {
  /** Stable id for de-dup, unique within its source (e.g. RemoteOK job id, a listing URL). Combined with the source name for the DB's SeenItem key. */
  externalId: string;
  source: string; // e.g. "remoteok", "weworkremotely"
  /** "job" = a formal listing with an apply link. "lead" = a founder/project signal with no listing yet (early opportunity, or a non-wage lead like co-founder/partnership/ambassador). */
  kind: "job" | "lead";
  posterUsername: string;
  title: string;
  summary: string;
  /** Raw pay text as posted, if any (e.g. "$60k-80k/year", "$25/hr"). Undefined if not listed. */
  payText?: string;
  /** Parsed hourly-equivalent USD, if payText could be parsed. Undefined if unlisted or unparseable. */
  hourlyUsd?: number;
  url: string;
  postedAt: Date;
  /** Source-provided category tags, if any (e.g. RemoteOK's job.tags). Used alongside title for role classification — see the comment on classifyRole in filter.ts for why the full description isn't used for that. */
  tags?: string[];
  /** Full free text (title + description + tags) — used for the unpaid/remote checks, where a broad scan is appropriate, but deliberately NOT for role classification. */
  searchText: string;
}

export type RoleCategory =
  | "full-stack-dev"
  | "management-strategist"
  | "community-manager"
  | "video-editor"
  | "ambassador"
  | "partnerships"
  | "co-founder"
  | "other";

/** Role categories where an hourly pay floor doesn't apply cleanly (equity/commission-based by nature) — see filter.ts. */
export const PAY_FLOOR_EXEMPT_CATEGORIES: ReadonlySet<RoleCategory> = new Set([
  "ambassador",
  "partnerships",
  "co-founder",
]);

export interface MatchedListing extends RawListing {
  roleCategory: RoleCategory;
  /** "high" = meets the $15/hr+ priority bar (spec). "standard" = meets the $10/hr floor (or is pay-floor-exempt). */
  priority: "high" | "standard";
}

/** A pluggable data source. Each one just fetches + normalizes; filtering/formatting/sending is shared. */
export interface JobSource {
  name: string;
  fetch(): Promise<RawListing[]>;
}
