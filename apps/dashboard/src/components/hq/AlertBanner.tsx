"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import type { StatsData } from "./types";

export function AlertBanner({ stats }: { stats: StatsData | null }) {
  if (!stats || stats.recentFailures.length === 0) return null;

  const latest = stats.recentFailures[0];

  return (
    <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-[#4a3a1e] bg-[#1f1a10] px-3 py-2 text-sm text-[#c8dcdc] sm:mx-6">
      <IconAlertTriangle size={16} className="shrink-0 text-jarvis-gold" />
      <span className="truncate">
        <span className="text-jarvis-gold mr-1">{stats.recentFailures.length} sources failed</span>
        — check logs: 
        <span className="font-mono text-xs text-[#a8c0c0] ml-1">
          [{latest.agentKey}] {latest.message}
        </span>
      </span>
    </div>
  );
}
