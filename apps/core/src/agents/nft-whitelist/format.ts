import { RawNftLead } from "./types";

/** Telegram message for one lead, per the spec's output format. */
export function formatLead(lead: RawNftLead): string {
  const type = lead.kind === "whitelist" ? "NFT Whitelist Lead" : "Ambassador Program Lead";

  const lines = [`*${type}*`, `Platform: ${lead.source}`];
  if (lead.posterUsername) lines.push(`Poster: ${lead.posterUsername}`);
  lines.push(lead.title);
  lines.push(lead.summary);
  if (lead.deadlineText) lines.push(`Deadline: ${lead.deadlineText}`);
  lines.push(`Verification: ${lead.verified ? "Verified" : "Unverified"} — ${lead.verificationNote}`);
  lines.push(lead.url);

  return lines.join("\n");
}
