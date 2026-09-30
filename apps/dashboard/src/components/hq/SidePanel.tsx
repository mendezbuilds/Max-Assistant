"use client";

import { useEffect, useState } from "react";
import { IconX } from "@tabler/icons-react";

type PanelMode = "schedule" | "activity" | "alerts";

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
  meta?: string | null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

const PANEL_POLL_MS = 15_000;

function ScheduleList() {
  const [items, setItems] = useState<ScheduleItem[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const load = () => fetch("/api/schedule").then((r) => r.json()).then(setItems).catch(() => {});
    load();
    const interval = setInterval(load, PANEL_POLL_MS);
    return () => clearInterval(interval);
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
                    (No draft — this is a system task, not content.)
                  </span>
                )}
                {/* Wired up now even with nothing real to act on yet — the
                    actual drafted-content system comes later once a
                    content-drafting agent exists. Disabled rather than
                    hidden for a system task, so the UI doesn't silently
                    pretend an action succeeded on content that isn't there. */}
                <div className="mt-2 flex gap-2">
                  <button
                    disabled={!item.draftContent}
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-700"
                  >
                    Edit
                  </button>
                  <button
                    disabled={!item.draftContent}
                    className="rounded border border-emerald-800 px-2 py-1 text-xs text-emerald-400 hover:border-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-emerald-800"
                  >
                    Approve
                  </button>
                </div>
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

  // Polls while the panel is open rather than fetching once on mount — the
  // whole point of an activity log is that it reflects what's happening
  // right now, not a snapshot from the moment you opened the panel.
  useEffect(() => {
    const load = () => fetch("/api/activity?limit=60").then((r) => r.json()).then(setEntries).catch(() => {});
    load();
    const interval = setInterval(load, PANEL_POLL_MS);
    return () => clearInterval(interval);
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

const ALERT_SEVERITY: Record<string, { label: string; color: string; dot: string }> = {
  error:   { label: "Critical", color: "text-rose-400",  dot: "bg-rose-500" },
  warn:    { label: "Warning",  color: "text-amber-400", dot: "bg-amber-500" },
  info:    { label: "Info",     color: "text-slate-300", dot: "bg-slate-500" },
};

function AlertsList({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [afterId, setAfterId] = useState<number>(0);

  useEffect(() => {
    // Fetch initial batch
    const loadInitial = async () => {
      try {
        const res = await fetch("/api/alerts");
        if (res.ok) {
          const data = await res.json();
          setEntries(data);
          if (data.length > 0) setAfterId(data[data.length - 1].id);
        }
      } catch { /* non-fatal */ }
    };
    loadInitial();
  }, []);

  useEffect(() => {
    if (afterId === 0 && entries !== null) return; // wait for initial load
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/alerts?afterId=${afterId}`);
        if (res.ok) {
          const newItems: ActivityEntry[] = await res.json();
          if (newItems.length > 0) {
            setEntries(prev => [...newItems, ...(prev ?? [])].slice(0, 100));
            setAfterId(newItems[newItems.length - 1].id);
          }
        }
      } catch { /* non-fatal */ }
    }, 10_000);
    return () => clearInterval(interval);
  }, [afterId, entries]);

  if (!entries) return <p className="text-sm text-slate-500">Loading alerts…</p>;
  if (entries.length === 0) return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="font-mono text-xs text-slate-500 uppercase tracking-wider">No alerts yet</p>
      <p className="mt-1 text-xs text-slate-600">Alerts will appear here as Degen Hunter discovers tokens.</p>
    </div>
  );

  return (
    <ul className="space-y-2">
      {entries.map((e) => {
        const sev = ALERT_SEVERITY[e.level] ?? ALERT_SEVERITY.info;
        let meta: any = {};
        try { meta = e.meta ? JSON.parse(e.meta as unknown as string) : {}; } catch { /* ignore */ }
        const type = meta.type ?? e.level;
        return (
          <li key={e.id} className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${sev.dot}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">{e.agentKey}</span>
                <span className={`text-[9px] font-bold uppercase tracking-wider ${sev.color}`}>{type}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-300">{e.message}</p>
              <p className="mt-0.5 text-[10px] text-slate-600">{formatTime(e.createdAt)}</p>
            </div>
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
  const title = mode === "schedule" ? "Schedule" : mode === "alerts" ? "Live Alerts" : "Activity";
  return (
    <div
      className={`fixed right-0 top-0 z-40 h-full w-full max-w-sm border-l border-slate-800 bg-slate-950/95 backdrop-blur-sm sm:max-w-md ${
        closing ? "panel-slide-out" : "panel-slide-in"
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 className="font-mono text-sm uppercase tracking-widest text-slate-300">{title}</h2>
        <button onClick={onClose} aria-label="Close panel" className="text-slate-500 hover:text-slate-200">
          <IconX size={18} />
        </button>
      </div>
      <div className="h-[calc(100%-49px)] overflow-y-auto p-4">
        {mode === "schedule" ? <ScheduleList /> : mode === "alerts" ? <AlertsList onClose={onClose} /> : <ActivityList />}
      </div>
    </div>
  );
}
