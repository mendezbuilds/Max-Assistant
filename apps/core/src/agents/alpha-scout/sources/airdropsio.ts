import * as cheerio from "cheerio";
import { AlphaSource, RawSignal } from "../types";
import { detectDeadline } from "../../../lib/deadline";
import { fetchWithRetry } from "../../../lib/http";

/**
 * airdrops.io has no official API or RSS for its actual airdrop listings
 * (its default WordPress feed only carries blog articles, not the
 * individual project cards). Its listing page, however, is plain
 * server-rendered HTML with a stable, well-structured custom-post-type
 * markup (verified 2026-09-13) — each airdrop is an `<article>` with rich
 * data-* attributes (publish timestamp, popularity, which social platforms
 * it requires) rather than a scattering of generically-named divs, so this
 * reads as a legitimate, reasonably stable structured-data source rather
 * than fragile screen-scraping. This is their own public listing page (no
 * login, no paywall) — a directory site whose business model depends on
 * being found and linked to, unlike e.g. LinkedIn.
 */
const LISTING_URL = "https://airdrops.io/latest/";

/** data-published is "YYYYMMDDHHmmss", not a standard format. */
function parsePublishedAttr(value: string | undefined): Date {
  if (!value || value.length !== 14) return new Date();
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export const airdropsIoSource: AlphaSource = {
  name: "airdropsio",

  async fetch(): Promise<RawSignal[]> {
    const res = await fetchWithRetry(LISTING_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MaxAlphaScout/1.0)" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`airdrops.io listing page returned ${res.status}: ${body.slice(0, 300)}`);
    }

    const $ = cheerio.load(await res.text());
    const signals: RawSignal[] = [];

    $("article.type-project").each((_, el) => {
      const article = $(el);
      const id = article.attr("id"); // "post-1980708"
      const title = article.find("h3").first().text().trim();
      const link =
        article.find("a.card-link-overlay").attr("href") ?? article.find("h3").parent("a").attr("href");
      if (!id || !title || !link) return; // skip anything that doesn't match the expected shape rather than push a broken entry

      const status = article.find(".status-indicator").text().trim() || "Unknown status";
      const actions = article.find(".front-drop-list .est-value span").first().text().trim();
      const summary = actions ? `${status}. Actions: ${actions}` : status;

      signals.push({
        externalId: `airdropsio:${id}`,
        source: "airdrops.io",
        kind: "testnet-airdrop",
        title,
        summary,
        url: link,
        foundAt: parsePublishedAttr(article.attr("data-published")),
        deadlineText: detectDeadline(`${title} ${summary}`),
      });
    });

    return signals;
  },
};
