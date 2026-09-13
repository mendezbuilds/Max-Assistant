import { NextResponse } from "next/server";
import { getStats } from "@/lib/stats";

/**
 * Aggregate stats for the HQ dashboard's stats row. "API credit remaining"
 * is deliberately not included — nothing in this system tracks usage/credit
 * for any API in play (Claude isn't called by any agent yet; none of the
 * job-scout/alpha-scout source APIs have usage tracking wired up). Rather
 * than fabricate a number, the frontend shows that stat as "—". Real data
 * only, per the brief.
 */
export async function GET() {
  return NextResponse.json(await getStats());
}
