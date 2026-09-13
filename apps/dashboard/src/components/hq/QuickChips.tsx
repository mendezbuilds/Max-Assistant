"use client";

import { IconCalendarTime, IconActivity } from "@tabler/icons-react";

export function QuickChips({ onOpen }: { onOpen: (mode: "schedule" | "activity") => void }) {
  return (
    <div className="flex justify-center gap-2 px-4 py-1">
      <button
        onClick={() => onOpen("schedule")}
        className="flex items-center gap-1.5 rounded-full border border-slate-800 px-3 py-1.5 font-mono text-xs text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
      >
        <IconCalendarTime size={14} /> Schedule
      </button>
      <button
        onClick={() => onOpen("activity")}
        className="flex items-center gap-1.5 rounded-full border border-slate-800 px-3 py-1.5 font-mono text-xs text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
      >
        <IconActivity size={14} /> Activity
      </button>
    </div>
  );
}
