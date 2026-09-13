import { JobSource, RawListing } from "../types";
import { annualUsdToHourly, parsePayFromText } from "../pay";
import { fetchWithRetry } from "../../../lib/http";

// RemoteOK returns raw HTML in `description` — strip tags for a plain-text
// summary rather than pulling in a full HTML parser for this alone.
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface RemoteOkJob {
  id?: string | number;
  slug?: string;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  url?: string;
  apply_url?: string;
  salary_min?: number;
  salary_max?: number;
  date?: string;
}

/**
 * RemoteOK's public JSON API (https://remoteok.com/api). No auth required,
 * but it does require a real User-Agent or it returns 403.
 */
export const remoteOkSource: JobSource = {
  name: "remoteok",

  async fetch(): Promise<RawListing[]> {
    const res = await fetchWithRetry("https://remoteok.com/api", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MaxJobScout/1.0; +https://github.com/) job-board-reader",
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`RemoteOK API returned ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];

    // The first array element is metadata (a "legal" notice), not a job.
    const jobs = data.slice(1) as RemoteOkJob[];

    return jobs
      .filter((job) => job.id && job.position)
      .map((job): RawListing => {
        const description = job.description ? stripHtml(job.description) : "";
        const searchText = [job.position, job.company, description, ...(job.tags ?? [])]
          .filter(Boolean)
          .join(" ");

        let hourlyUsd: number | undefined;
        let payText: string | undefined;
        if (job.salary_min || job.salary_max) {
          const min = job.salary_min ?? job.salary_max!;
          const max = job.salary_max ?? job.salary_min!;
          hourlyUsd = annualUsdToHourly((min + max) / 2);
          payText = `$${Math.round(min / 1000)}k-${Math.round(max / 1000)}k/year`;
        } else {
          hourlyUsd = parsePayFromText(description);
        }

        return {
          externalId: `remoteok:${job.id}`,
          source: "RemoteOK",
          kind: "job",
          posterUsername: job.company ?? "unknown",
          title: job.position ?? "Untitled role",
          summary: description.slice(0, 300) + (description.length > 300 ? "…" : ""),
          payText,
          hourlyUsd,
          url: job.apply_url || job.url || `https://remoteok.com/remote-jobs/${job.id}`,
          postedAt: job.date ? new Date(job.date) : new Date(),
          tags: job.tags,
          searchText,
        };
      });
  },
};
