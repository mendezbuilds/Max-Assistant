"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import type { StatsData } from "./types";

/** Hidden entirely when there's nothing to flag — no failures in the recent window. Real data only (see /api/stats): "API credit low" isn't wired up since no usage-tracking data exists yet to trigger it from. */
export function AlertBanner({ stats }: { stats: StatsData | null }) {
  if (!stats || stats.recentFailures.length === 0) return null;

  const latest = stats.recentFailures[0];

  return (
    <div className="mx-4 flex items-center gap-2 rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-400 sm:mx-6">
      <IconAlertTriangle size={16} className="shrink-0" />
      <span className="truncate">
        {stats.recentFailures.length > 1
          ? `${stats.recentFailures.length} source issues in the last 2 hours — latest: `
          : "Source issue: "}
        <span className="font-mono text-xs text-amber-300">
          [{latest.agentKey}] {latest.message}
        </span>
      </span>
    </div>
  );
}
