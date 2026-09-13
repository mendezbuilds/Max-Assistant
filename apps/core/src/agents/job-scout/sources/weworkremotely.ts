import { JobSource, RawListing } from "../types";
import { parsePayFromText } from "../pay";
import { createLenientXmlParser, stripHtml } from "./xml";

// WeWorkRemotely has no JSON API; per-category RSS feeds are the standard
// integration point. Using the sitewide feed (rather than guessing category
// slugs) and letting filter.ts's role-keyword matching do the narrowing —
// add more/narrower feed URLs here later if that turns out too broad.
const FEED_URLS = ["https://weworkremotely.com/remote-jobs.rss"];

interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  guid?: string | { "#text": string };
}

export const weWorkRemotelySource: JobSource = {
  name: "weworkremotely",

  async fetch(): Promise<RawListing[]> {
    const parser = createLenientXmlParser();
    const listings: RawListing[] = [];

    for (const feedUrl of FEED_URLS) {
      const res = await fetch(feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MaxJobScout/1.0)" },
      });
      if (!res.ok) {
        throw new Error(`WeWorkRemotely feed ${feedUrl} returned ${res.status}`);
      }

      const xml = await res.text();
      const parsed = parser.parse(xml);
      const items: RssItem[] = parsed?.rss?.channel?.item ?? [];
      const itemList = Array.isArray(items) ? items : [items];

      for (const item of itemList) {
        if (!item.title || !item.link) continue;

        // WWR titles are conventionally "Company: Job Title".
        const [company, ...rest] = item.title.split(":");
        const jobTitle = rest.length > 0 ? rest.join(":").trim() : item.title;
        const description = item.description ? stripHtml(item.description) : "";
        const searchText = [item.title, description].join(" ");
        const guid = typeof item.guid === "string" ? item.guid : item.guid?.["#text"];

        listings.push({
          externalId: `weworkremotely:${guid ?? item.link}`,
          source: "WeWorkRemotely",
          kind: "job",
          posterUsername: company.trim(),
          title: jobTitle,
          summary: description.slice(0, 300) + (description.length > 300 ? "…" : ""),
          hourlyUsd: parsePayFromText(searchText),
          url: item.link,
          postedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
          searchText,
        });
      }
    }

    return listings;
  },
};
