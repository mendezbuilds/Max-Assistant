import { JobSource, RawListing } from "../types";

/**
 * Mercor has no public jobs API/RSS, but unlike Turing and micro1 (pure
 * "apply once, get matched" funnels with no discrete listings — see
 * stubs.ts) its public careers page (mercor.com/experts) does render
 * individual listings, and — because it's a Next.js site — the exact data
 * behind them ships as JSON in a `__NEXT_DATA__` <script> tag on every page
 * load, no login or reverse-engineering required. This reads that embedded
 * JSON rather than scraping rendered HTML — more brittle to a framework
 * change on their end, but far less brittle to a CSS/markup tweak, which is
 * the more common kind of change.
 *
 * Every listing here belongs to the "AI Training / RLHF" category (per
 * addendum) regardless of its individual title's wording — see
 * forcedRoleCategory in types.ts.
 */
const PAGE_URL = "https://www.mercor.com/experts/";

interface MercorJob {
  listingId?: string;
  title?: string;
  rateMin?: number;
  rateMax?: number;
  payRateFrequency?: string; // "hourly" | "one-time" (seen); treat anything else as unparseable
  numHires?: number;
}

function extractNextData(html: string): unknown {
  const start = html.indexOf('<script id="__NEXT_DATA__"');
  if (start === -1) return undefined;
  const tagEnd = html.indexOf(">", start) + 1;
  const scriptEnd = html.indexOf("</script>", tagEnd);
  if (tagEnd === 0 || scriptEnd === -1) return undefined;

  try {
    return JSON.parse(html.slice(tagEnd, scriptEnd));
  } catch {
    return undefined;
  }
}

export const mercorSource: JobSource = {
  name: "mercor",

  async fetch(): Promise<RawListing[]> {
    const res = await fetch(PAGE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MaxJobScout/1.0)" },
    });
    if (!res.ok) {
      throw new Error(`Mercor page returned ${res.status}`);
    }

    const data = extractNextData(await res.text()) as
      | { props?: { pageProps?: { latestJobs?: MercorJob[]; talentNetworkJobs?: MercorJob[] } } }
      | undefined;

    const pageProps = data?.props?.pageProps;
    if (!pageProps) {
      throw new Error("Mercor page's __NEXT_DATA__ shape has changed — parser needs updating");
    }

    const jobs = [...(pageProps.latestJobs ?? []), ...(pageProps.talentNetworkJobs ?? [])];

    return jobs
      .filter((job) => job.listingId && job.title)
      .map((job): RawListing => {
        const isHourly = job.payRateFrequency === "hourly";
        const hourlyUsd =
          isHourly && (job.rateMin || job.rateMax)
            ? ((job.rateMin ?? job.rateMax!) + (job.rateMax ?? job.rateMin!)) / 2
            : undefined;
        const rateLabel =
          job.rateMin != null && job.rateMax != null
            ? job.rateMin === job.rateMax
              ? `$${job.rateMin}`
              : `$${job.rateMin}-${job.rateMax}`
            : undefined;
        const payText = rateLabel ? `${rateLabel}${isHourly ? "/hr" : " (one-time)"}` : undefined;

        return {
          externalId: `mercor:${job.listingId}`,
          source: "Mercor",
          kind: "job",
          posterUsername: "Mercor", // platform-posted, not an individual — see RawListing.posterUsername
          title: job.title!,
          summary: `${job.numHires ?? 0} hires so far on this listing.`,
          payText,
          hourlyUsd,
          url: `https://work.mercor.com/jobs/${job.listingId}`,
          postedAt: new Date(), // not exposed in this embedded payload
          remote: true, // Mercor's expert network is remote-first by design
          forcedRoleCategory: "ai-training-rlhf",
          searchText: job.title!,
        };
      });
  },
};
