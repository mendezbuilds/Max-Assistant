/**
 * Pay parsing is inherently fuzzy (free text, wildly different formats across
 * boards) — these helpers are deliberately conservative: when a listing's pay
 * can't be confidently parsed, callers should treat it as "unlisted" (kept,
 * not excluded) rather than guessing and wrongly excluding/including it. See
 * filter.ts for how "unlisted" is handled.
 */

const HOURS_PER_YEAR = 2080; // 40hr/week * 52 weeks — standard full-time-equivalent estimate

export function annualUsdToHourly(annualUsd: number): number {
  return annualUsd / HOURS_PER_YEAR;
}

/** True if the text explicitly signals a volunteer/unpaid role (as opposed to just not mentioning pay). */
export function mentionsUnpaid(text: string): boolean {
  return /\b(unpaid|volunteer(?:\s+only)?|no\s+pay|no\s+compensation)\b/i.test(text);
}

/**
 * Best-effort extraction of an hourly-equivalent USD rate from free text.
 * Handles the common shapes: "$25/hr", "$25 per hour", "$60k-80k/year",
 * "$60,000-$80,000 a year". Returns undefined if nothing confidently parses.
 */
export function parsePayFromText(text: string): number | undefined {
  const hourlyMatch = text.match(/\$\s?(\d{1,3}(?:\.\d+)?)\s*(?:\/|per)\s*h(?:ou)?r/i);
  if (hourlyMatch) {
    return Number(hourlyMatch[1]);
  }

  // Annual range like "$60k-80k/year", "$60,000 - $80,000 / yr", "$60k/year"
  const annualMatch = text.match(
    /\$\s?(\d{1,3}(?:,\d{3})?)(k)?(?:\s?-\s?\$?\s?(\d{1,3}(?:,\d{3})?)(k)?)?\s*(?:\/|per)\s*(?:yr|year|annum)/i
  );
  if (annualMatch) {
    const parseAmount = (num: string, isK: string | undefined) => {
      const n = Number(num.replace(/,/g, ""));
      return isK ? n * 1000 : n;
    };
    const min = parseAmount(annualMatch[1], annualMatch[2]);
    const max = annualMatch[3] ? parseAmount(annualMatch[3], annualMatch[4]) : min;
    return annualUsdToHourly((min + max) / 2);
  }

  return undefined;
}
