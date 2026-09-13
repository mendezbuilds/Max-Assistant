import { MatchedListing } from "./types";

const ROLE_LABELS: Record<MatchedListing["roleCategory"], string> = {
  "full-stack-dev": "Full-Stack Dev",
  "management-strategist": "Management / Strategist",
  "community-manager": "Community Mod/Manager",
  "video-editor": "Video Editor",
  ambassador: "Ambassador Program",
  partnerships: "Partnerships",
  "co-founder": "Co-Founder Opportunity",
  other: "Other",
};

/** Telegram message for one match, per the spec's output format. */
export function formatListing(listing: MatchedListing): string {
  const type = listing.kind === "job" ? "Job Match" : "Opportunity Lead";
  const priorityTag = listing.priority === "high" ? " 🔥 HIGH PRIORITY" : "";
  const pay = listing.hourlyUsd !== undefined
    ? `${listing.payText ?? `~$${listing.hourlyUsd.toFixed(0)}/hr`}`
    : listing.payText ?? "not listed";

  return [
    `*${type}*${priorityTag} — ${ROLE_LABELS[listing.roleCategory]}`,
    `Platform: ${listing.source}`,
    `Poster: ${listing.posterUsername}`,
    `${listing.title}`,
    listing.summary,
    `Pay: ${pay}`,
    listing.url,
  ].join("\n");
}
