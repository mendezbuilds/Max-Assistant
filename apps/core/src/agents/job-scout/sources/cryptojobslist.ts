import { JobSource, RawListing } from "../types";
import { parsePayFromText } from "../pay";
import { createLenientXmlParser, stripHtml } from "./xml";

const FEED_URL = "https://api.cryptojobslist.com/jobs.rss";

// Verified shape (2026-09): no <pubDate>, company comes via <dc:creator>
// (Dublin Core namespace — fast-xml-parser doesn't resolve namespaces, so
// it comes through as the literal key "dc:creator"), and tags live as text
// inside <description> rather than as their own element. Unlike
// WeWorkRemotely, this board isn't remote-only — it lists on-site crypto
// roles too — so the shared isRemote() text check actually matters here.
interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  "dc:creator"?: string;
  guid?: string | { "#text": string };
}

export const cryptoJobsListSource: JobSource = {
  name: "cryptojobslist",

  async fetch(): Promise<RawListing[]> {
    const res = await fetch(FEED_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MaxJobScout/1.0)" },
    });
    if (!res.ok) {
      throw new Error(`CryptoJobsList feed returned ${res.status}`);
    }

    const xml = await res.text();
    const parsed = createLenientXmlParser().parse(xml);
    const items: RssItem[] = parsed?.rss?.channel?.item ?? [];
    const itemList = Array.isArray(items) ? items : [items];

    return itemList
      .filter((item) => item.title && item.link)
      .map((item): RawListing => {
        const description = item.description ? stripHtml(item.description) : "";
        // Descriptions open with a bullet-separated "Tags: A • B • C" run
        // before the actual text — keep it in searchText (it's genuinely
        // useful there: e.g. "Remote Jobs"/"Full Time Jobs" tags are what
        // make the remote/unpaid checks work for this non-remote-only
        // board), but strip it from the human-facing summary.
        const lastTagBullet = description.lastIndexOf("•");
        const summaryText = lastTagBullet === -1 ? description : description.slice(lastTagBullet + 1).trim();
        const searchText = [item.title, description].join(" ");
        const guid = typeof item.guid === "string" ? item.guid : item.guid?.["#text"];

        return {
          externalId: `cryptojobslist:${guid ?? item.link}`,
          source: "CryptoJobsList",
          kind: "job",
          posterUsername: item["dc:creator"] ?? "unknown",
          title: item.title!,
          summary: summaryText.slice(0, 300) + (summaryText.length > 300 ? "…" : ""),
          hourlyUsd: parsePayFromText(searchText),
          url: item.link!,
          postedAt: new Date(), // feed doesn't include a publish date
          searchText,
        };
      });
  },
};
