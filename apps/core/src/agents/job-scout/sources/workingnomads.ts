import { JobSource, RawListing } from "../types";
import { parsePayFromText } from "../pay";
import { stripHtml } from "./xml";

const API_URL = "https://www.workingnomads.com/api/exposed_jobs/";

// Verified shape (2026-09): plain JSON array, no key required.
interface WorkingNomadsJob {
  url?: string;
  title?: string;
  description?: string;
  company_name?: string;
  category_name?: string;
  tags?: string; // comma-separated, not an array
  location?: string;
  pub_date?: string;
}

export const workingNomadsSource: JobSource = {
  name: "workingnomads",

  async fetch(): Promise<RawListing[]> {
    const res = await fetch(API_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MaxJobScout/1.0)" },
    });
    if (!res.ok) {
      throw new Error(`Working Nomads API returned ${res.status}`);
    }

    const jobs = (await res.json()) as WorkingNomadsJob[];
    if (!Array.isArray(jobs)) return [];

    return jobs
      .filter((job) => job.url && job.title)
      .map((job): RawListing => {
        const description = job.description ? stripHtml(job.description) : "";
        const tags = job.tags
          ? job.tags.split(",").map((t) => t.trim()).filter(Boolean)
          : undefined;
        const searchText = [job.title, description, job.category_name, job.location, job.tags]
          .filter(Boolean)
          .join(" ");

        return {
          externalId: `workingnomads:${job.url}`,
          source: "WorkingNomads",
          kind: "job",
          posterUsername: job.company_name ?? "unknown",
          title: job.title!,
          summary: description.slice(0, 300) + (description.length > 300 ? "…" : ""),
          hourlyUsd: parsePayFromText(description),
          url: job.url!,
          postedAt: job.pub_date ? new Date(job.pub_date) : new Date(),
          tags,
          // This board is remote-only by construction; its listings don't
          // reliably restate "remote" in their own text (location is often
          // just "Worldwide"), so trust the board rather than the text scan.
          remote: true,
          searchText,
        };
      });
  },
};
