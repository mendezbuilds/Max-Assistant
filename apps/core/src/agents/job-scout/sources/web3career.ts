import { JobSource, RawListing } from "../types";
import { parsePayFromText, annualUsdToHourly } from "../pay";
import { stripHtml } from "./xml";

/**
 * Web3.career's Jobs API (https://web3.career/web3-jobs-api) requires a free
 * token you request from them — set WEB3_CAREER_API_TOKEN in .env to enable
 * this source; until then it behaves like the other not-configured stubs.
 *
 * ⚠️ Unverified response shape: their docs page didn't expose the exact JSON
 * field names (the full reference is behind a signup-gated docs site I
 * couldn't access without a token), only that `token`/`remote`/`tag`/`limit`
 * are query params and `apply_url` exists on each job. This parser is a
 * best-effort guess at common field-name variants, filtered defensively so a
 * wrong guess yields zero results (logged) rather than garbage output. If
 * this logs "fetched 0 jobs" once a real token is set, the field names below
 * need adjusting against an actual response — worth a spot-check on first run.
 */
const API_URL = "https://web3.career/api/v1";

interface Web3CareerJobGuess {
  id?: string | number;
  job_id?: string | number;
  title?: string;
  position?: string;
  company?: string;
  company_name?: string;
  tags?: string[];
  description?: string;
  desc?: string;
  apply_url?: string;
  url?: string;
  link?: string;
  salary?: string;
  salary_text?: string;
  salary_min?: number;
  salary_max?: number;
  date?: string;
  published_at?: string;
  posted_at?: string;
}

function unwrapList(data: unknown): Web3CareerJobGuess[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["jobs", "data", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as Web3CareerJobGuess[];
    }
  }
  return [];
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

    const jobs = unwrapList(await res.json());

    return jobs
      .filter((job) => (job.title || job.position) && (job.apply_url || job.url || job.link))
      .map((job): RawListing => {
        const title = job.title ?? job.position ?? "Untitled role";
        const description = stripHtml(job.description ?? job.desc ?? "");
        const searchText = [title, job.company, job.company_name, description, ...(job.tags ?? [])]
          .filter(Boolean)
          .join(" ");

        const salaryText = job.salary ?? job.salary_text;
        let hourlyUsd: number | undefined;
        if (job.salary_min || job.salary_max) {
          const min = job.salary_min ?? job.salary_max!;
          const max = job.salary_max ?? job.salary_min!;
          hourlyUsd = annualUsdToHourly((min + max) / 2);
        } else if (salaryText) {
          hourlyUsd = parsePayFromText(salaryText);
        } else {
          hourlyUsd = parsePayFromText(description);
        }

        return {
          externalId: `web3career:${job.id ?? job.job_id ?? job.apply_url ?? job.url}`,
          source: "Web3.career",
          kind: "job",
          posterUsername: job.company ?? job.company_name ?? "unknown",
          title,
          summary: description.slice(0, 300) + (description.length > 300 ? "…" : ""),
          payText: salaryText,
          hourlyUsd,
          url: job.apply_url ?? job.url ?? job.link!,
          postedAt: new Date(job.date ?? job.published_at ?? job.posted_at ?? Date.now()),
          tags: job.tags,
          remote: true, // requested via the API's own remote=true filter
          searchText,
        };
      });
  },
};
