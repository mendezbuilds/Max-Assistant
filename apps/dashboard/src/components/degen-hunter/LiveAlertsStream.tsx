"use client";

import { useEffect, useRef } from "react";
import { IconBell, IconX } from "@tabler/icons-react";
import { fmtAgeMin, fmtUsd } from "./risk";
import type { LiveAlert } from "./useLiveAlerts";
import type { DashboardToken } from "./types";

/**
 * One accent color per alert, so a glance tells you what it is:
 *   new signal  → by risk: LOW green · MEDIUM amber · HIGH rose · CRITICAL red · unscored slate
 *   tracking    → blue
 *   exit signal → deep red, on a darker warmer base (so it can't be mistaken for a HIGH-risk signal)
 */
interface Look {
  accent: string;
  /** Short heading shown in the accent color. */
  label: string;
  /** Base color behind the tint. */
  base: string;
}

const SIGNAL_ACCENT = { LOW: "#34d399", MEDIUM: "#fbbf24", HIGH: "#f43f5e", CRITICAL: "#ff1744", NONE: "#94a3b8" } as const;

function lookFor(a: LiveAlert): Look {
  // Rugged: the darkest, most saturated red — the one alert that is already a loss, not a warning.
  if (a.rugged) return { accent: "#b91c1c", label: "☠ Rugged · watchlist", base: "#160809" };
  if (a.kind === "exit") return { accent: "#dc2626", label: a.watchlist ? "Watchlist drop" : "Exit signal", base: "#1a0d0e" };
  if (a.kind === "tracking") return { accent: "#38bdf8", label: a.watchlist ? "Watchlist update" : "Tracking update", base: "#0b1218" };
  const risk = a.risk ?? "NONE";
  return { accent: SIGNAL_ACCENT[risk], label: `New signal${a.risk ? ` · ${a.risk} risk` : ""}`, base: "#0c1114" };
}

/** Space kept between stacked alerts (px). */
const GAP = 12;
/** How quickly displayed positions chase their targets (higher = snappier). Gives the smooth slide when a new alert pushes the rest up. */
const EASE_PER_SEC = 7;

/**
 * Renders the live alerts as a stack anchored to the bottom of the column.
 * A new alert comes up in from below and takes the bottom slot; everything
 * already there is pushed up by exactly its height. Nothing moves otherwise —
 * alerts sit still until a newer one arrives under them (or one above/below
 * expires, in which case the rest settle back down). Each alert removes
 * itself on its own timer (owned by useLiveAlerts, which also fades it out first).
 *
 * `slim` is the narrow always-on sidebar on the orbit view; `full` is the
 * wider column on the dedicated Degen Hunter screen (every field).
 */
export function LiveAlertsStream({
  alerts,
  onDismiss,
  onOpenDetails,
  variant = "full",
}: {
  alerts: LiveAlert[];
  onDismiss: (id: string) => void;
  onOpenDetails?: (token: DashboardToken) => void;
  variant?: "slim" | "full";
}) {
  const { containerRef, register } = useStackLayout(alerts);

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
      {alerts.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
          <IconBell className="mb-2 text-slate-800" size={22} />
          <p className="font-mono text-xs uppercase tracking-wider text-slate-600">No live alerts</p>
          <p className="mt-1 text-[10px] text-slate-700">Waiting for events…</p>
        </div>
      )}
      {alerts.map((a) => (
        // Outer wrapper owns position (transform set every frame by the layout
        // loop); the alert inside owns its own fade-in/out animation.
        <div
          key={a.id}
          ref={(el) => register(a.id, el)}
          className="absolute left-3 right-3 top-0 will-change-transform"
          style={{ transform: "translateY(-9999px)" }}
        >
          <AlertShape alert={a} variant={variant} onDismiss={onDismiss} onOpenDetails={onOpenDetails} />
        </div>
      ))}
    </div>
  );
}

/**
 * Positions the alerts every frame: newest at the bottom, each older one
 * stacked above it. A brand-new alert starts just below the visible area and
 * eases up into its slot, and the others ease to their new slots, so
 * arrivals and removals slide instead of jumping. Transforms are written
 * straight to the DOM (no React re-render per frame). Reduced-motion users
 * get the same stack without the easing.
 */
function useStackLayout(alerts: LiveAlert[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const els = useRef<Map<string, HTMLDivElement>>(new Map());
  const ys = useRef<Map<string, number>>(new Map());
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  const register = (id: string, el: HTMLDivElement | null) => {
    if (el) els.current.set(id, el);
    else {
      els.current.delete(id);
      ys.current.delete(id);
    }
  };

  useEffect(() => {
    const box = containerRef.current;
    if (!box) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const H = box.clientHeight;
      const ease = 1 - Math.exp(-EASE_PER_SEC * (dt / 1000));

      // newest first: each alert sits directly above the one before it
      const ordered = [...alertsRef.current].sort((a, b) => b.shownAt - a.shownAt);
      let bottom = H; // lower edge available to the next alert up
      for (const a of ordered) {
        const el = els.current.get(a.id);
        if (!el) continue;
        const h = el.offsetHeight;
        const target = bottom - h;

        const prev = ys.current.get(a.id) ?? H + 8; // brand-new: starts just below the visible area
        const y = reduce ? target : prev + (target - prev) * ease;
        ys.current.set(a.id, y);
        el.style.transform = `translateY(${y.toFixed(1)}px)`;
        bottom = target - GAP;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return { containerRef, register };
}

/**
 * The alert's own shape: deliberately not a plain bordered rectangle. A
 * tinted glass slab with a clipped top-right corner, a glowing accent edge
 * down the left, and a soft color wash that fades out toward the right. The
 * glow is a drop-shadow on the outer element because the clip-path on the
 * inner one would cut off an ordinary box-shadow.
 */
function AlertShape({
  alert: a,
  variant,
  onDismiss,
  onOpenDetails,
}: {
  alert: LiveAlert;
  variant: "slim" | "full";
  onDismiss: (id: string) => void;
  onOpenDetails?: (token: DashboardToken) => void;
}) {
  const { accent, label, base } = lookFor(a);
  const slim = variant === "slim";

  return (
    <div
      className={`group ${a.leaving ? "alert-card-leave" : "alert-card-enter"}`}
      style={{ filter: `drop-shadow(0 0 ${a.kind === "exit" ? 14 : 9}px ${accent}${a.kind === "exit" ? "66" : "44"})` }}
    >
      <div
        className="relative py-3 pl-4 pr-3.5"
        style={{
          clipPath: "polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%)",
          borderRadius: "10px 0 0 10px",
          background: `linear-gradient(105deg, ${accent}2e 0%, ${accent}12 42%, transparent 100%), ${base}`,
        }}
      >
        {/* glowing accent edge */}
        <span
          className="absolute bottom-0 left-0 top-0 w-[3px]"
          style={{ background: accent, boxShadow: `0 0 10px 1px ${accent}` }}
        />

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: accent }}>
              {label}
            </p>
            <p className="mt-0.5 truncate text-[13px] font-semibold leading-tight text-slate-100">
              {a.kind === "signal" ? a.title : `$${a.symbol}`}
              {a.kind === "signal" && a.symbol !== a.title && <span className="ml-1 font-normal text-slate-500">${a.symbol}</span>}
            </p>
          </div>
          <button
            onClick={() => onDismiss(a.id)}
            className="mr-3 shrink-0 text-slate-600 opacity-0 transition hover:text-slate-300 group-hover:opacity-100"
            title="Dismiss (history is kept)"
          >
            <IconX size={11} />
          </button>
        </div>

        {a.kind === "signal" && (
          <div className="mt-2 flex flex-col gap-1">
            <p className="font-mono text-[11px] font-bold text-slate-200">
              {a.score ?? "—"}<span className="text-slate-500">/100</span>
            </p>
            <p className="font-mono text-[10px] leading-snug text-slate-400">
              {slim
                ? `${fmtUsd(a.marketCap)} mcap · ${fmtUsd(a.liquidity)} liq`
                : `${a.chain ?? "—"} · ${fmtAgeMin(a.ageMinutes)} old · mcap ${fmtUsd(a.marketCap)} · liq ${fmtUsd(a.liquidity)} · vol ${fmtUsd(a.volume)}`}
            </p>
            {(a.warnings?.length ?? 0) > 0 && (
              <p className="text-[10px] leading-snug text-amber-400/90">⚠ {slim ? a.warnings![0] : a.warnings!.slice(0, 2).join(" · ")}</p>
            )}
          </div>
        )}

        {a.kind !== "signal" && (
          <div className="mt-2 flex flex-col gap-0.5">
            <p className="font-mono text-[10px] text-slate-400">
              {fmtUsd(a.entryMarketCap)} → {fmtUsd(a.currentMarketCap)} mcap
            </p>
            {a.multiple != null && (
              <p className="font-mono text-sm font-bold" style={{ color: accent }}>
                {a.kind === "tracking" ? `${a.multiple.toFixed(1)}×` : `${((a.multiple - 1) * 100).toFixed(0)}%`}
              </p>
            )}
            {a.kind === "exit" && (
              <p className="text-[10px]" style={{ color: `${accent}cc` }}>
                {a.rugged ? "price or liquidity collapsed — tracking stopped" : a.watchlist ? "down since you added it" : "threshold breached — review position"}
              </p>
            )}
          </div>
        )}

        {a.token && onOpenDetails && !slim && (
          <button onClick={() => onOpenDetails(a.token!)} className="mt-2 text-[10px] text-orange-400 hover:text-orange-300">
            View →
          </button>
        )}
      </div>
    </div>
  );
}
