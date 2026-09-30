"use client";

import { useState, useEffect, useCallback } from "react";
import { IconBell, IconX } from "@tabler/icons-react";
import type { DashboardToken } from "./types";

interface StreamAlert {
  id: string;
  icon: string;
  title: string;
  time: string;
  severity: "info" | "warn" | "critical";
  token?: DashboardToken;
}

const SEVERITY_LEFT: Record<StreamAlert["severity"], string> = {
  info:     "border-l-slate-600",
  warn:     "border-l-amber-500",
  critical: "border-l-rose-500",
};

export function LiveAlertsStream({ onOpenDetails }: { onOpenDetails: (token: DashboardToken) => void }) {
  const [alerts, setAlerts] = useState<StreamAlert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/degen-hunter/feed?limit=30");
      if (!res.ok) return;
      const data = await res.json();
      const tokens: DashboardToken[] = data.tokens ?? [];

      const stream: StreamAlert[] = [];

      for (const t of tokens.slice(0, 20)) {
        const flags = t.riskFlags ?? [];
        const score = t.totalScore;

        if (t.honeypotStatus === "honeypot-risk") {
          stream.push({ id: `hp_${t.tokenId}`, icon: "🚨", title: `Honeypot: ${t.symbol ?? "Token"}`, time: t._updatedAt ?? "", severity: "critical", token: t });
        } else if (flags.includes("extreme-risk") || (score !== undefined && score < 20)) {
          stream.push({ id: `xr_${t.tokenId}`, icon: "🚨", title: `Extreme risk: ${t.symbol ?? "Token"}`, time: t._updatedAt ?? "", severity: "critical", token: t });
        } else if (flags.includes("high-risk") || (score !== undefined && score < 45)) {
          stream.push({ id: `hr_${t.tokenId}`, icon: "⚠", title: `High risk: ${t.symbol ?? "Token"}`, time: t._updatedAt ?? "", severity: "warn", token: t });
        } else if (t.mintAuthorityActive === true) {
          stream.push({ id: `ma_${t.tokenId}`, icon: "⚠", title: `Mint auth active: ${t.symbol ?? "Token"}`, time: t._updatedAt ?? "", severity: "warn", token: t });
        } else {
          stream.push({ id: `nd_${t.tokenId}`, icon: "🔥", title: `New: ${t.name ?? t.symbol ?? "Token"}`, time: t._updatedAt ?? "", severity: "info", token: t });
        }
      }

      // Deduplicate and merge with existing (keep dismissed state)
      setAlerts(prev => {
        const existingIds = new Set(prev.map(a => a.id));
        const newAlerts = stream.filter(a => !existingIds.has(a.id));
        return [...newAlerts, ...prev].slice(0, 50);
      });
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const t = setInterval(fetchAlerts, 20_000);
    return () => clearInterval(t);
  }, [fetchAlerts]);

  const visible = alerts.filter(a => !dismissed.has(a.id));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {visible.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <IconBell className="mb-2 text-slate-800" size={22} />
          <p className="font-mono text-xs text-slate-600 uppercase tracking-wider">No alerts yet</p>
          <p className="mt-1 text-[10px] text-slate-700">Waiting for events…</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto p-2">
          {visible.map(alert => (
            <div
              key={alert.id}
              className={`relative rounded-lg border-l-2 bg-slate-900/40 p-2.5 ${SEVERITY_LEFT[alert.severity]}`}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="flex items-start gap-1.5 min-w-0">
                  <span className="text-sm shrink-0">{alert.icon}</span>
                  <p className="text-xs font-medium text-slate-300 leading-tight truncate">{alert.title}</p>
                </div>
                <button
                  onClick={() => setDismissed(prev => new Set([...prev, alert.id]))}
                  className="shrink-0 text-slate-700 hover:text-slate-500"
                >
                  <IconX size={10} />
                </button>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-[9px] text-slate-600">{alert.time ? new Date(alert.time).toLocaleTimeString() : "—"}</p>
                {alert.token && (
                  <button
                    onClick={() => onOpenDetails(alert.token!)}
                    className="text-[9px] text-orange-500 hover:text-orange-400"
                  >
                    View
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
