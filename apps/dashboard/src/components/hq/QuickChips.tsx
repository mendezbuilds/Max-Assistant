"use client";

import { IconCalendarTime, IconActivity, IconBell } from "@tabler/icons-react";

export function QuickChips({ onOpen }: { onOpen: (mode: "schedule" | "activity" | "alerts") => void }) {
  return (
    <div className="flex justify-start gap-2 px-4 py-1 mt-1 sm:px-6">
      <button
        onClick={() => onOpen("schedule")}
        className="flex items-center gap-1.5 rounded-md border border-jarvis-border bg-jarvis-panel px-3 py-1.5 font-mono text-[11px] text-[#a8c0c0] transition hover:border-jarvis-cyan hover:text-jarvis-cyan"
      >
        <IconCalendarTime size={14} /> Schedule
      </button>
      <button
        onClick={() => onOpen("activity")}
        className="flex items-center gap-1.5 rounded-md border border-jarvis-border bg-jarvis-panel px-3 py-1.5 font-mono text-[11px] text-[#a8c0c0] transition hover:border-jarvis-cyan hover:text-jarvis-cyan"
      >
        <IconActivity size={14} /> Reports
      </button>
      <button
        onClick={() => onOpen("alerts")}
        className="flex items-center gap-1.5 rounded-md border border-orange-900/60 bg-jarvis-panel px-3 py-1.5 font-mono text-[11px] text-orange-400 transition hover:border-orange-500 hover:text-orange-300"
      >
        <IconBell size={14} /> Live Alerts
      </button>
    </div>
  );
}
