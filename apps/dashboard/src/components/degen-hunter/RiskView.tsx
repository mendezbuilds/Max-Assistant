"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { IconAlertTriangle, IconRefresh, IconSearch, IconFilter, IconShield } from "@tabler/icons-react";
import { TokenCard } from "./TokenCard";
import { useWatchlist } from "./useWatchlist";
import type { DashboardToken } from "./types";

type RiskFilter = "All" | "Low" | "Medium" | "High" | "Extreme";

export function RiskView({ onOpenDetails }: { onOpenDetails: (token: DashboardToken) => void }) {
  const [tokens, setTokens] = useState<DashboardToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("All");

  const { watched, watch, unwatch } = useWatchlist();

  const fetchRisk = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/degen-hunter/risk?limit=100");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTokens(data.tokens ?? []);
      setError(null);
      setLastFetch(new Date());
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRisk();
    const interval = setInterval(fetchRisk, 30_000);
    return () => clearInterval(interval);
  }, [fetchRisk]);

  const handleRefresh = () => {
    setLoading(true);
    fetchRisk();
  };

  // Aggregations
  const stats = useMemo(() => {
    let high = 0;
    let extreme = 0;
    let honeypot = 0;
    let lowLiq = 0;
    let unverified = 0;

    for (const t of tokens) {
      const s = t.totalScore ?? 0;
      
      // Determine risk tier based on score or explicit flags
      let tier = "Low";
      if (t.riskFlags?.includes("extreme-risk")) tier = "Extreme";
      else if (t.riskFlags?.includes("high-risk") || s < 45) tier = "High";
      else if (s < 70) tier = "Medium";

      if (tier === "High") high++;
      if (tier === "Extreme") extreme++;
      
      if (t.honeypotStatus === "honeypot-risk") honeypot++;
      if (t.riskFlags?.includes("low-liquidity")) lowLiq++;
      if (t.contractVerified === false || t.riskFlags?.includes("unverified-contract")) unverified++;
    }

    return { high, extreme, honeypot, lowLiq, unverified };
  }, [tokens]);

  // Filtering
  const filteredTokens = useMemo(() => {
    if (riskFilter === "All") return tokens;
    return tokens.filter(t => {
      const s = t.totalScore ?? 0;
      let tier = "Low";
      if (t.riskFlags?.includes("extreme-risk")) tier = "Extreme";
      else if (t.riskFlags?.includes("high-risk") || s < 45) tier = "High";
      else if (s < 70) tier = "Medium";
      return tier === riskFilter;
    });
  }, [tokens, riskFilter]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconAlertTriangle className="text-amber-500" size={20} />
          <h2 className="text-lg font-bold text-slate-200">Risk Analysis</h2>
        </div>
        <div className="flex items-center gap-3">
          {lastFetch && (
            <span className="hidden text-xs text-slate-500 sm:inline">
              Updated {lastFetch.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-50"
          >
            <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="text-xs text-slate-500 uppercase tracking-widest font-mono">Extreme Risk</div>
          <div className="mt-1 text-xl font-bold text-rose-500">{stats.extreme}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="text-xs text-slate-500 uppercase tracking-widest font-mono">High Risk</div>
          <div className="mt-1 text-xl font-bold text-amber-500">{stats.high}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="text-xs text-slate-500 uppercase tracking-widest font-mono">Honeypot</div>
          <div className="mt-1 text-xl font-bold text-rose-500">{stats.honeypot}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="text-xs text-slate-500 uppercase tracking-widest font-mono">Low Liq</div>
          <div className="mt-1 text-xl font-bold text-amber-400">{stats.lowLiq}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="text-xs text-slate-500 uppercase tracking-widest font-mono">Unverified</div>
          <div className="mt-1 text-xl font-bold text-slate-300">{stats.unverified}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-800/60">
        <IconFilter size={16} className="text-slate-500 mr-1 shrink-0" />
        {(["All", "Low", "Medium", "High", "Extreme"] as RiskFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setRiskFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider shrink-0 transition-colors ${
              riskFilter === f 
                ? "bg-slate-700 text-white" 
                : "bg-slate-900/50 text-slate-400 hover:bg-slate-800 hover:text-slate-300"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* States */}
      {loading && tokens.length === 0 && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-slate-800 bg-slate-900/40" />
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-rose-900/40 bg-rose-950/20 py-10 text-center">
          <p className="font-mono text-sm text-rose-400">Error: {error}</p>
          <button onClick={handleRefresh} className="mt-3 rounded bg-slate-800 px-4 py-2 text-xs text-slate-200">Retry</button>
        </div>
      )}

      {!loading && !error && filteredTokens.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 border-dashed py-16 text-center">
          <IconShield className="mb-3 text-slate-700" size={28} />
          <p className="font-mono text-sm font-medium uppercase tracking-widest text-slate-500">No Tokens Found</p>
          <p className="mt-1 text-xs text-slate-600">No tokens match the current risk filter.</p>
        </div>
      )}

      {/* Token List */}
      {!error && filteredTokens.length > 0 && (
        <div className="flex flex-col gap-3">
          {filteredTokens.map((token) => {
            const addr = token.contractAddress ?? token.tokenId;
            const isWatched = addr ? watched.has(addr) : false;
            return (
              <TokenCard
                key={token.tokenId ?? token._rowId}
                token={token}
                isWatched={isWatched}
                onDetails={() => onOpenDetails(token)}
                onWatch={addr ? () => (isWatched ? unwatch(addr) : watch(addr)) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
