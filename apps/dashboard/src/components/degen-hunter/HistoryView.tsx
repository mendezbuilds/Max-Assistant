"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { IconHistory, IconRefresh, IconSearch, IconAlertTriangle } from "@tabler/icons-react";
import type { DashboardToken } from "./types";

type HistoryCategory = "all" | "discoveries" | "trades" | "watchlist" | "risk";

interface HistoryEntry {
  id: string;
  category: HistoryCategory;
  icon: string;
  title: string;
  detail: string;
  timestamp: string;
  token?: DashboardToken;
}

export function HistoryView({ onOpenDetails }: { onOpenDetails: (token: DashboardToken) => void }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<HistoryCategory>("all");
  const [search, setSearch] = useState("");
  const [notMapped, setNotMapped] = useState(false);

  const fetchHistory = useCallback(async () => {
    const result: HistoryEntry[] = [];

    try {
      // Discoveries from token feed
      const feedRes = await fetch("/api/agents/degen-hunter/feed?limit=200");
      if (feedRes.ok) {
        const feedData = await feedRes.json();
        for (const t of feedData.tokens ?? []) {
          result.push({
            id: `disc_${t.tokenId}`,
            category: "discoveries",
            icon: "🔥",
            title: `Discovered ${t.name ?? "Unknown"} (${t.symbol ? "$" + t.symbol : "—"})`,
            detail: `via ${t.discoverySource ?? "unknown"} · Score ${t.totalScore ?? "—"}/100 · ${t.chain ?? "?"}`,
            timestamp: t._updatedAt ?? t.discoveredAt ?? new Date().toISOString(),
            token: t,
          });

          // Risk events for high-risk tokens
          const flags = t.riskFlags ?? [];
          if (flags.length > 0 || (t.totalScore !== undefined && t.totalScore < 45)) {
            result.push({
              id: `risk_${t.tokenId}`,
              category: "risk",
              icon: "⚠",
              title: `Risk flagged: ${t.name ?? "Unknown"}`,
              detail: flags.slice(0, 3).join(", ") || `Score ${t.totalScore}/100`,
              timestamp: t._updatedAt ?? t.lastUpdatedAt ?? new Date().toISOString(),
              token: t,
            });
          }
        }
      }

      // Trades from wallet
      const walletRes = await fetch("/api/agents/degen-hunter/wallet");
      if (walletRes.status === 401) {
        const d = await walletRes.json();
        if (d?.error === "identity_not_mapped") setNotMapped(true);
      } else if (walletRes.ok) {
        const walletData = await walletRes.json();
        for (const act of walletData.recentActivity ?? []) {
          // recentActivity rows are positions: { amountSOL, entryPriceUsd, status: OPEN | CLOSED }.
          // (This used to read amountSol / price / action, which don't exist, and threw on the first trade.)
          const closed = act.status === "CLOSED";
          result.push({
            id: `trade_${act.id}`,
            category: "trades",
            icon: closed ? "💸" : "💰",
            title: `${closed ? "Closed" : "Bought"} $${act.tokenSymbol}`,
            detail: `${Number(act.amountSOL).toFixed(4)} SOL · entry @$${Number(act.entryPriceUsd).toExponential(2)}`,
            timestamp: act.timestamp,
          });
        }
      }

      // Watchlist from watchlist API
      const watchRes = await fetch("/api/agents/degen-hunter/watchlist");
      if (watchRes.ok) {
        const watchData = await watchRes.json();
        for (const entry of watchData.watchlist ?? []) {
          result.push({
            id: `watch_${entry.tokenAddress}`,
            category: "watchlist",
            icon: "👁",
            title: `Watchlisted ${entry.tokenAddress.slice(0, 8)}…`,
            detail: `Added to watchlist`,
            timestamp: entry.addedAt,
          });
        }
      }

    } catch { /* non-fatal */ }

    // Sort newest first, dedup by id
    const seen = new Set<string>();
    const sorted = result
      .filter(e => { const d = seen.has(e.id); seen.add(e.id); return !d; })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    setEntries(sorted);
    setLoading(false);
  }, []);

  // Load once, then keep itself current (skipped while the tab is hidden).
  useEffect(() => {
    fetchHistory();
    const t = setInterval(() => { if (document.visibilityState === "visible") fetchHistory(); }, 30_000);
    return () => clearInterval(t);
  }, [fetchHistory]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return entries.filter(e => {
      if (category !== "all" && e.category !== category) return false;
      if (q && !e.title.toLowerCase().includes(q) && !e.detail.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, category, search]);

  const tabs: { id: HistoryCategory; label: string }[] = [
    { id: "all",          label: "All" },
    { id: "discoveries",  label: "Discoveries" },
    { id: "trades",       label: "Trades" },
    { id: "watchlist",    label: "Watchlist" },
    { id: "risk",         label: "Risk Events" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconHistory className="text-orange-500" size={20} />
          <h2 className="text-lg font-bold text-slate-200">History</h2>
          <span className="text-sm text-slate-500">({filtered.length})</span>
        </div>
        <button onClick={() => { setLoading(true); fetchHistory(); }} disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50">
          <IconRefresh size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {notMapped && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-900/30 bg-amber-950/10 p-3 text-xs text-amber-500/80">
          <IconAlertTriangle size={12} />Trade history unavailable — DEGEN_OWNER_CHAT_ID not set.
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 border-b border-slate-800/60">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setCategory(tab.id)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors ${
              category === tab.id ? "bg-slate-700 text-white" : "text-slate-500 hover:bg-slate-800 hover:text-slate-300"
            }`}>{tab.label}</button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search history…"
          className="w-full rounded-lg border border-slate-800 bg-slate-900/60 py-2 pl-8 pr-3 text-sm text-slate-300 placeholder-slate-600 outline-none focus:border-slate-600" />
      </div>

      {loading && (
        <div className="flex flex-col gap-2">
          {[1,2,3,4].map(i => <div key={i} className="h-16 animate-pulse rounded-xl border border-slate-800 bg-slate-900/40" />)}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 py-16 text-center">
          <IconHistory className="mb-3 text-slate-700" size={28} />
          <p className="font-mono text-sm uppercase tracking-widest text-slate-500">No history</p>
          <p className="mt-1 text-xs text-slate-600">Activity will appear here as the discovery agent runs.</p>
        </div>
      )}

      <div className="flex flex-col divide-y divide-slate-800/60">
        {filtered.map(entry => (
          <div key={entry.id} className="flex items-start gap-3 py-3">
            <span className="mt-0.5 text-base shrink-0">{entry.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-300 font-medium">{entry.title}</p>
              <p className="text-xs text-slate-500">{entry.detail}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] text-slate-600">{new Date(entry.timestamp).toLocaleString()}</p>
              {entry.token && (
                <button onClick={() => onOpenDetails(entry.token!)} className="mt-0.5 text-[10px] text-orange-500 hover:text-orange-400">
                  View →
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
