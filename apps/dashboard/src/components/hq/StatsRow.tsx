"use client";

import type { StatsData } from "./types";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-slate-800/70 bg-slate-900/40 px-3 py-2 sm:px-5 sm:py-3">
      <span className="font-mono text-lg font-semibold text-slate-100 sm:text-xl">{value}</span>
      <span className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
    </div>
  );
}

export function StatsRow({ stats }: { stats: StatsData | null }) {
  return (
    <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:flex sm:justify-center sm:gap-4 sm:px-6">
      <Stat label="Agents Active" value={stats ? `${stats.agentsActive}/${stats.agentsTotal}` : "—"} />
      <Stat label="Sources Watched" value={stats?.sourcesWatched ?? "—"} />
      <Stat label="Matches Today" value={stats?.matchesToday ?? "—"} />
      <Stat label="API Credit" value={stats?.apiCreditRemaining ?? "—"} />
    </div>
  );
}
