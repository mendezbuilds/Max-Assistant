"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { IconBell, IconRefresh, IconAlertTriangle, IconX, IconChevronDown } from "@tabler/icons-react";
import { assess } from "./risk";
import type { DashboardToken } from "./types";

interface Alert {
  id: string;
  type: "new_token" | "score_change" | "risk_change" | "critical" | "liquidity" | "volume" | "watchlist" | "milestone";
  title: string;
  body: string;
  token?: DashboardToken;
  timestamp: string;
  severity: "info" | "warn" | "critical";
}

const TYPE_LABEL: Record<Alert["type"], string> = {
  new_token:    "New Discovery",
  score_change: "Score Change",
  risk_change:  "Risk Change",
  critical:     "Critical Warning",
  liquidity:    "Liquidity Alert",
  volume:       "Volume Spike",
  watchlist:    "Watchlist",
  milestone:    "Milestone",
};

const SEVERITY_STYLES: Record<Alert["severity"], string> = {
  info:     "border-l-slate-600 bg-slate-900/40",
  warn:     "border-l-amber-600 bg-amber-950/20",
  critical: "border-l-rose-600 bg-rose-950/20",
};

const SEVERITY_DOT: Record<Alert["severity"], string> = {
  info:     "bg-slate-500",
  warn:     "bg-amber-500",
  critical: "bg-rose-500",
};

/** Build synthetic alerts from real token feed + risk data */
async function buildAlerts(): Promise<Alert[]> {
  const alerts: Alert[] = [];

  try {
    const feedRes = await fetch("/api/agents/degen-hunter/feed?limit=50");
    if (feedRes.ok) {
      const feedData = await feedRes.json();
      const tokens: DashboardToken[] = feedData.tokens ?? [];

      for (const t of tokens) {
        const updatedAt = t._updatedAt ?? t.lastUpdatedAt ?? new Date().toISOString();

        // New discovery alert
        alerts.push({
          id: `new_${t.tokenId}`,
          type: "new_token",
          title: `New Token Discovered`,
          body: `${t.name ?? "Unknown"} (${t.symbol ? "$" + t.symbol : "—"}) found via ${t.discoverySource ?? "unknown"}. Score: ${t.totalScore ?? "—"}/100`,
          token: t,
          timestamp: updatedAt,
          severity: "info",
        });

        // Risk-based alerts
        // From the one shared assessment: the level is derived from the flags, so each of
        // these alerts has the reasons to show. (This used to key off flag names nothing
        // produced and a LOW opportunity score, so "High Risk" had nothing behind it.)
        const risk = assess(t);
        const flags = risk.riskFlags;
        const score = t.totalScore ?? 100;

        if (risk.level === "critical") {
          alerts.push({
            id: `risk_extreme_${t.tokenId}`,
            type: "critical",
            title: "Critical Risk",
            body: `${t.name ?? t.tokenId}: ${risk.warnings.slice(0, 2).join(" · ")}`,
            token: t,
            timestamp: updatedAt,
            severity: "critical",
          });
        } else if (risk.level === "high") {
          alerts.push({
            id: `risk_high_${t.tokenId}`,
            type: "risk_change",
            title: "High Risk Token",
            body: `${t.name ?? t.tokenId}: ${risk.warnings.slice(0, 2).join(" · ")}`,
            token: t,
            timestamp: updatedAt,
            severity: "warn",
          });
        }

        if (flags.includes("honeypot-risk") || t.honeypotStatus === "honeypot-risk") {
          alerts.push({
            id: `honeypot_${t.tokenId}`,
            type: "critical",
            title: "⚠ Honeypot Risk",
            body: `${t.name ?? t.tokenId} has honeypot indicators. Selling may be blocked.`,
            token: t,
            timestamp: updatedAt,
            severity: "critical",
          });
        }

        if (t.mintAuthorityActive === true) {
          alerts.push({
            id: `mint_${t.tokenId}`,
            type: "risk_change",
            title: "Mint Authority Active",
            body: `${t.name ?? t.tokenId} has an active mint authority — unlimited token supply inflation possible.`,
            token: t,
            timestamp: updatedAt,
            severity: "warn",
          });
        }

        // Low liquidity
        if (flags.includes("low-liquidity") || (t.liquidityUsd !== undefined && t.liquidityUsd < 5000)) {
          alerts.push({
            id: `liq_${t.tokenId}`,
            type: "liquidity",
            title: "Low Liquidity Warning",
            body: `${t.name ?? t.tokenId} liquidity is $${t.liquidityUsd?.toLocaleString() ?? "Unknown"}. High slippage risk.`,
            token: t,
            timestamp: updatedAt,
            severity: "warn",
          });
        }

        // Volume spike (volume > 3× market cap or very high relative volume)
        if (t.volume24hUsd !== undefined && t.liquidityUsd !== undefined && t.volume24hUsd > t.liquidityUsd * 5) {
          alerts.push({
            id: `vol_${t.tokenId}`,
            type: "volume",
            title: "Volume Spike",
            body: `${t.name ?? t.tokenId} 24h volume ($${(t.volume24hUsd / 1000).toFixed(1)}K) is ${(t.volume24hUsd / t.liquidityUsd).toFixed(0)}× liquidity.`,
            token: t,
            timestamp: updatedAt,
            severity: "info",
          });
        }
      }
    }
  } catch { /* non-fatal */ }

  // Sort newest first, deduplicate by id
  const seen = new Set<string>();
  return alerts
    .filter(a => { const dup = seen.has(a.id); seen.add(a.id); return !dup; })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 100);
}

type FilterType = "all" | Alert["type"];

export function AlertsView({ onOpenDetails }: { onOpenDetails: (token: DashboardToken) => void }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const fetch_ = useCallback(async () => {
    const a = await buildAlerts();
    setAlerts(a);
    setLoading(false);
  }, []);

  useEffect(() => { fetch_(); const t = setInterval(fetch_, 30_000); return () => clearInterval(t); }, [fetch_]);

  const visible = alerts.filter(a => !dismissed.has(a.id) && (filter === "all" || a.type === filter));

  const filterCounts: Partial<Record<FilterType, number>> = { all: alerts.filter(a => !dismissed.has(a.id)).length };
  for (const a of alerts) {
    if (!dismissed.has(a.id)) filterCounts[a.type] = (filterCounts[a.type] ?? 0) + 1;
  }

  const filterTabs: { id: FilterType; label: string }[] = [
    { id: "all",      label: "All" },
    { id: "critical", label: "Critical" },
    { id: "new_token",label: "Discoveries" },
    { id: "risk_change", label: "Risk" },
    { id: "liquidity",  label: "Liquidity" },
    { id: "volume",     label: "Volume" },
    { id: "milestone",  label: "Milestones" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconBell className="text-orange-500" size={20} />
          <h2 className="text-lg font-bold text-slate-200">Alerts</h2>
        </div>
        <button
          onClick={() => { setLoading(true); fetch_(); }}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
        >
          <IconRefresh size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 border-b border-slate-800/60">
        {filterTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors ${
              filter === tab.id ? "bg-slate-700 text-white" : "text-slate-500 hover:bg-slate-800 hover:text-slate-300"
            }`}
          >
            {tab.label}{filterCounts[tab.id] ? ` · ${filterCounts[tab.id]}` : ""}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex flex-col gap-2">
          {[1,2,3].map(i => <div key={i} className="h-20 animate-pulse rounded-xl border border-slate-800 bg-slate-900/40" />)}
        </div>
      )}

      {!loading && visible.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 py-16 text-center">
          <IconBell className="mb-3 text-slate-700" size={28} />
          <p className="font-mono text-sm uppercase tracking-widest text-slate-500">No Alerts</p>
          <p className="mt-1 text-xs text-slate-600">Alerts generate from real token events. Run the discovery agent to populate.</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {visible.map(alert => (
          <div
            key={alert.id}
            className={`relative flex gap-3 rounded-xl border-l-4 p-4 ${SEVERITY_STYLES[alert.severity]}`}
          >
            <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[alert.severity]}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="mr-2 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    {TYPE_LABEL[alert.type]}
                  </span>
                  <span className="text-sm font-bold text-slate-200">{alert.title}</span>
                </div>
                <button
                  onClick={() => setDismissed(prev => new Set([...prev, alert.id]))}
                  className="shrink-0 text-slate-600 hover:text-slate-400"
                >
                  <IconX size={14} />
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-400 leading-relaxed">{alert.body}</p>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-[10px] text-slate-600">{new Date(alert.timestamp).toLocaleString()}</span>
                {alert.token && (
                  <button
                    onClick={() => onOpenDetails(alert.token!)}
                    className="text-[10px] text-orange-500 hover:text-orange-400 underline"
                  >
                    View Token →
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {dismissed.size > 0 && (
        <button
          onClick={() => setDismissed(new Set())}
          className="text-center text-xs text-slate-600 hover:text-slate-400"
        >
          Restore {dismissed.size} dismissed alert{dismissed.size > 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}
