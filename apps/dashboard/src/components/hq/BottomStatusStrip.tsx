"use client";

import { useEffect, useState } from "react";
import type { StatsData } from "./types";

export function BottomStatusStrip({ stats }: { stats: StatsData | null }) {
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString(undefined, { hour12: false }));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    // mb-[58px] rather than a Tailwind step — the fixed CommandBar
    // floating below measures 56px tall after its own padding trim, so
    // this needs to match that exactly (with a couple px to spare) rather
    // than landing on whichever preset happens to be close.
    <div className="mb-[58px] flex items-center justify-between border-t border-slate-800/70 px-4 py-1 font-mono text-[11px] text-slate-500 sm:px-6">
      <span>
        {stats ? `${stats.sourcesWatched} sources · ${stats.agentsActive} agents active` : "—"}
      </span>
      <span>{clock}</span>
    </div>
  );
}
