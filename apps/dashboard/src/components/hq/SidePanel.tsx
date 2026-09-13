"use client";

import { useEffect, useState } from "react";
import { IconX } from "@tabler/icons-react";

type PanelMode = "schedule" | "activity";

interface ScheduleItem {
  kind: "poll";
  agentKey: string;
  agentName: string;
  nextRunAt: string;
  draftContent: string | null;
}

interface ActivityEntry {
  id: number;
  agentKey: string;
  level: string;
  message: string;
  createdAt: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function ScheduleList() {
  const [items, setItems] = useState<ScheduleItem[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/schedule")
      .then((r) => r.json())
      .then(setItems);
  }, []);

  if (!items) return <p className="text-sm text-slate-500">Loading…</p>;
  if (items.length === 0) return <p className="text-sm text-slate-500">No enabled agents are scheduled right now.</p>;

  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const id = `${item.agentKey}-${item.nextRunAt}`;
        const isOpen = expanded === id;
        return (
          <li key={id} className="rounded-lg border border-slate-800 bg-slate-900/60">
            <button
              onClick={() => setExpanded(isOpen ? null : id)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left"
            >
              <span className="text-sm text-slate-200">{item.agentName} — poll cycle</span>
              <span className="text-xs text-slate-500">{formatTime(item.nextRunAt)}</span>
            </button>
            {isOpen && (
              <div className="border-t border-slate-800 px-3 py-2.5 text-sm text-slate-400">
                {item.draftContent ?? (
                  <span className="italic text-slate-500">
                    System task — no drafted content to review (no content-drafting system exists for this
                    agent yet).
                  </span>
                )}
                {item.draftContent && (
                  <div className="mt-2 flex gap-2">
                    <button className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500">
                      Edit
                    </button>
                    <button className="rounded border border-emerald-800 px-2 py-1 text-xs text-emerald-400 hover:border-emerald-600">
                      Approve
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ActivityList() {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);

  useEffect(() => {
    fetch("/api/activity?limit=60")
      .then((r) => r.json())
      .then(setEntries);
  }, []);

  if (!entries) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <ul className="space-y-1.5">
      {entries.map((e) => {
        const isWarning = e.level === "warn" || e.level === "error";
        return (
          <li
            key={e.id}
            className={`rounded-md px-2.5 py-1.5 text-sm ${
              isWarning ? "border border-amber-900/60 bg-amber-950/30 text-amber-400" : "text-slate-400"
            }`}
          >
            <span className="font-mono text-xs text-slate-600">[{e.agentKey}]</span> {e.message}
            <span className="ml-2 text-xs text-slate-600">{formatTime(e.createdAt)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function SidePanel({
  mode,
  closing,
  onClose,
}: {
  mode: PanelMode;
  closing: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className={`fixed right-0 top-0 z-40 h-full w-full max-w-sm border-l border-slate-800 bg-slate-950/95 backdrop-blur-sm sm:max-w-md ${
        closing ? "panel-slide-out" : "panel-slide-in"
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 className="font-mono text-sm uppercase tracking-widest text-slate-300">{mode}</h2>
        <button onClick={onClose} aria-label="Close panel" className="text-slate-500 hover:text-slate-200">
          <IconX size={18} />
        </button>
      </div>
      <div className="h-[calc(100%-49px)] overflow-y-auto p-4">
        {mode === "schedule" ? <ScheduleList /> : <ActivityList />}
      </div>
    </div>
  );
}
