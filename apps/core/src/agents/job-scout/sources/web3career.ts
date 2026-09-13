import { JobSource, RawListing } from "../types";
import { annualUsdToHourly } from "../pay";
import { stripHtml } from "./xml";

/**
 * Web3.career's Jobs API (https://web3.career/web3-jobs-api) requires a free
 * token you request from them — set WEB3_CAREER_API_TOKEN in .env to enable
 * this source; until then it behaves like the other not-configured stubs.
 *
 * Verified live against a real token (2026-09-13). The initial guess at the
 * response shape was wrong — it's not a flat array of jobs, nor a wrapped
 * {jobs:[...]}. The real shape is a 3-element top-level array:
 * `[usageHelpText, termsOfServiceText, realJobsArray]` — the actual jobs are
 * at index 2. Their ToS (surfaced in that same text) requires linking back
 * via apply_url with a followable link and crediting web3.career as the
 * source, or they'll suspend API access — keep that in mind if this output
 * is ever displayed somewhere other than a private/semi-private Telegram
 * feed.
 */
const API_URL = "https://web3.career/api/v1";

interface Web3CareerJob {
  id: number;
  date?: string;
  is_remote?: boolean;
  title?: string;
  company?: string;
  location?: string;
  apply_url?: string;
  tags?: string[];
  description?: string;
  salary_min_value?: number | null;
  salary_max_value?: number | null;
  // Web3.career's own estimate when the poster didn't give an explicit
  // range — still a genuinely useful pay signal, not a guess this code is
  // making itself.
  estimated_min_salary?: number | null;
  estimated_max_salary?: number | null;
}

export const web3CareerSource: JobSource = {
  name: "web3career",

  async fetch(): Promise<RawListing[]> {
    const token = process.env.WEB3_CAREER_API_TOKEN;
    if (!token) {
      console.warn(
        "[job-scout] web3career source not configured: set WEB3_CAREER_API_TOKEN " +
          "(request one free at https://web3.career/web3-jobs-api)"
      );
      return [];
    }

    const url = `${API_URL}?token=${encodeURIComponent(token)}&remote=true&limit=100`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MaxJobScout/1.0)" },
    });
    if (!res.ok) {
      throw new Error(`Web3.career API returned ${res.status}`);
    }

    const body = (await res.json()) as unknown;
    const jobs: Web3CareerJob[] = Array.isArray(body) && Array.isArray(body[2]) ? body[2] : [];

    return jobs
      .filter((job) => job.id && job.title && job.apply_url)
      .map((job): RawListing => {
        const description = stripHtml(job.description ?? "");
        const searchText = [job.title, job.company, description, ...(job.tags ?? [])]
          .filter(Boolean)
          .join(" ");

        const min = job.salary_min_value ?? job.estimated_min_salary;
        const max = job.salary_max_value ?? job.estimated_max_salary;
        const hourlyUsd = min || max ? annualUsdToHourly(((min ?? max)! + (max ?? min)!) / 2) : undefined;
        const payText =
          min || max
            ? `$${Math.round((min ?? max)! / 1000)}k-${Math.round((max ?? min)! / 1000)}k/year` +
              (job.salary_min_value == null ? " (estimated)" : "")
            : undefined;

        return {
          externalId: `web3career:${job.id}`,
          source: "Web3.career",
          kind: "job",
          posterUsername: job.company ?? "unknown",
          title: job.title!,
          summary: description.slice(0, 300) + (description.length > 300 ? "…" : ""),
          payText,
          hourlyUsd,
          url: job.apply_url!,
          postedAt: job.date ? new Date(job.date) : new Date(),
          tags: job.tags,
          remote: job.is_remote, // authoritative field the API itself provides
          searchText,
        };
      });
  },
};
