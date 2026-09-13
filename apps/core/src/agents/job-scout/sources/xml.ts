import { XMLParser } from "fast-xml-parser";

/**
 * Job-board RSS feeds tend to have enough HTML entities in their descriptions
 * (e.g. "&amp;" repeated across dozens of postings) to blow past
 * fast-xml-parser's default entity-expansion limits (a billion-laughs-attack
 * guard) on a normal, non-malicious feed. Raise them rather than disabling
 * the guard entirely — shared by every RSS-based source instead of each one
 * re-tuning its own limits.
 */
export function createLenientXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    processEntities: { enabled: true, maxTotalExpansions: 200_000, maxExpandedLength: 10_000_000 },
  });
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
