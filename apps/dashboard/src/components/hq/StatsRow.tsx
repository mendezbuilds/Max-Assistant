"use client";

import type { StatsData } from "./types";

export function StatsRow({ stats }: { stats: StatsData | null }) {
  return (
    <div className="flex justify-between items-center px-4 py-1 border-b border-jarvis-border sm:px-6">
      <span className="font-mono text-[10px] text-jarvis-dim uppercase tracking-wider">
        AGENTS <b className="text-jarvis-green font-semibold">{stats ? stats.agentsActive : "—"}</b>/{stats ? stats.agentsTotal : "—"}
      </span>
      <span className="font-mono text-[10px] text-jarvis-dim uppercase tracking-wider">
        SOURCES <b className="text-jarvis-cyan font-semibold">{stats?.sourcesWatched ?? "—"}</b>
      </span>
      <span className="font-mono text-[10px] text-jarvis-dim uppercase tracking-wider hidden sm:inline">
        MATCHES <b className="text-jarvis-cyan font-semibold">{stats?.matchesToday ?? "—"}</b>
      </span>
      <span className="font-mono text-[10px] text-jarvis-dim uppercase tracking-wider">
        CREDIT <b className="text-jarvis-gold font-semibold">{stats?.apiCreditRemaining ?? "—"}</b>
      </span>
    </div>
  );
}
