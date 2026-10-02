"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { IconX, IconBell, IconArrowRight, IconFlame } from "@tabler/icons-react";

interface Alert {
  id: number;
  agentKey: string;
  level: string;
  message: string;
  meta: any;
}

/** How long a toast stays up, and how many show at once; the rest queue. */
const TOAST_MS = 6000;
const MAX_VISIBLE = 2;

/**
 * Toast popups are for ONE kind of event: a tracking update on a token already being
 * tracked (a watchlist token or an open position hitting an X, dropping, being rugged,
 * or its risk rising — the risk change is part of that token's tracking message, never
 * its own alert). Everything else the core publishes — new discoveries, standalone
 * High/Critical risk alerts, "added to watchlist" confirmations — is not toasted.
 * Those still exist in the activity log, the Live Alerts panel and the live feed
 * sidebar, which read the same alerts but are not filtered here.
 */
function isTrackingUpdate(type: unknown): boolean {
  if (typeof type !== "string") return false;
  return type === "tracking-update" || type === "2x-milestone" || type.startsWith("watchlist-") || type.startsWith("position-");
}

export function Toaster({ onZoomAgent }: { onZoomAgent: (key: string) => void }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const lastCheckedId = useRef<number | null>(null);

  // Poll for new alerts
  useEffect(() => {
    // Initial fetch just to get the max ID so we don't spam old alerts on refresh
    const initializeId = async () => {
      try {
        // Fetch the single most recent alert just to set the cursor
        const res = await fetch("/api/alerts?limit=1");
        if (res.ok) {
          const data = await res.json();
          if (data.length > 0) {
            lastCheckedId.current = data[data.length - 1].id;
          } else {
            lastCheckedId.current = 0;
          }
        }
      } catch (e) {
        console.error("Failed to initialize toaster ID", e);
        lastCheckedId.current = 0;
      }
    };

    initializeId();

    const interval = setInterval(async () => {
      if (lastCheckedId.current === null) return;

      try {
        const res = await fetch(`/api/alerts?afterId=${lastCheckedId.current}`);
        if (res.ok) {
          const newAlerts: any[] = await res.json();
          if (newAlerts.length > 0) {
            // Update cursor
            lastCheckedId.current = newAlerts[newAlerts.length - 1].id;

            // Parse meta, keep only tracking updates, and append to queue. The cursor above has
            // already moved past everything fetched, so rows dropped here are never refetched.
            const parsedAlerts = newAlerts
              .map(a => ({
                ...a,
                meta: a.meta ? JSON.parse(a.meta) : {}
              }))
              .filter(a => isTrackingUpdate(a.meta?.type));

            if (parsedAlerts.length > 0) setAlerts(prev => [...prev, ...parsedAlerts]);
          }
        }
      } catch (e) {
        console.error("Failed to fetch alerts", e);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const dismissAlert = useCallback((id: number) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleView = (alert: Alert) => {
    dismissAlert(alert.id);
    onZoomAgent(alert.agentKey);
  };

  if (alerts.length === 0) return null;

  // Only the first MAX_VISIBLE are on screen; the rest wait their turn. A toast's countdown starts
  // when it appears (the ToastCard mounts), not when it was queued, so a queued one still gets its full time.
  const visible = alerts.slice(0, MAX_VISIBLE);
  const waiting = alerts.length - visible.length;

  return (
    <div className="pointer-events-none fixed left-0 right-0 top-16 z-50 flex flex-col items-center gap-3">
      {visible.map((alert) => (
        <ToastCard key={alert.id} alert={alert} onView={handleView} onDismiss={dismissAlert} />
      ))}
      {waiting > 0 && (
        <div className="pointer-events-none rounded-full bg-slate-900/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          +{waiting} more
        </div>
      )}
    </div>
  );
}

function ToastCard({ alert, onView, onDismiss }: { alert: Alert; onView: (a: Alert) => void; onDismiss: (id: number) => void }) {
  const isDegen = alert.agentKey === "degen-hunter";
  const Icon = isDegen ? IconFlame : IconBell;
  const colorClass = isDegen ? "text-orange-500" : "text-slate-200";
  const borderClass = isDegen ? "border-orange-500/30" : "border-slate-700";
  const barClass = isDegen ? "bg-orange-500" : "bg-slate-300";

  // Dismiss timer and countdown bar share TOAST_MS and both start on mount, so the bar is empty exactly when the toast goes.
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setRunning(true)); // next frame, so the full -> empty transition actually animates
    const timer = setTimeout(() => onDismiss(alert.id), TOAST_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [alert.id, onDismiss]);

  return (
    <div
      className={`pointer-events-auto relative flex w-full max-w-md items-center justify-between gap-4 overflow-hidden rounded-xl border bg-slate-950/95 p-3 shadow-2xl shadow-black/50 backdrop-blur-md transition-all animate-in slide-in-from-top-4 fade-in duration-300 ${borderClass}`}
    >
      <div className="flex flex-1 items-center gap-3 overflow-hidden">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 ${colorClass}`}>
          <Icon size={20} />
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {alert.agentKey.replace("-", " ")}
            </span>
            <span className="rounded bg-sky-950 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-sky-400">
              Tracking update
            </span>
          </div>
          {/* wraps to a few lines: a tracking message can carry a risk phrase, and one truncated line would cut it off */}
          <p className="line-clamp-3 break-words text-sm font-medium text-slate-200">{alert.message}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onView(alert)}
          className="flex items-center gap-1 rounded bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700"
        >
          VIEW <IconArrowRight size={14} />
        </button>
        <button
          onClick={() => onDismiss(alert.id)}
          className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          aria-label="Dismiss"
        >
          <IconX size={16} />
        </button>
      </div>
      {/* countdown: a bar along the bottom edge that drains to empty as the toast dismisses */}
      <div
        data-testid="toast-countdown"
        className={`absolute bottom-0 left-0 h-[3px] w-full origin-left ${barClass}`}
        style={{ transform: running ? "scaleX(0)" : "scaleX(1)", transition: running ? `transform ${TOAST_MS}ms linear` : "none" }}
      />
    </div>
  );
}
