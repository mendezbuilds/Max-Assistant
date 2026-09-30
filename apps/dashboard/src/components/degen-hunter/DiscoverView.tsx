"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { IconSearch, IconRefresh, IconFlame, IconFilter, IconClock, IconAlertTriangle } from "@tabler/icons-react";
import { TokenCard } from "./TokenCard";
import { useWatchlist } from "./useWatchlist";
import type { DashboardToken } from "./types";

type ProfileFilter = "all" | "newMeme" | "momentum" | "lowCap" | "trending";
type AgeFilter = "all" | "1h" | "6h" | "24h" | "72h";

const PROFILE_LABELS: Record<ProfileFilter, string> = {
  all: "All Profiles",
  newMeme: "New Meme",
  momentum: "Momentum",
  lowCap: "Low Cap",
  trending: "Trending",
};

function matchProfile(token: DashboardToken, profile: ProfileFilter): boolean {
  if (profile === "all") return true;
  const ageMin = token.tokenAgeMinutes;
  const liq = token.liquidityUsd ?? 0;
  const vol24 = token.volume24hUsd ?? 0;
  const mcap = token.marketCapUsd ?? Infinity;

  switch (profile) {
    case "newMeme":
      return (ageMin === undefined || ageMin < 1440) && liq >= 5000 && vol24 >= 1000 && mcap <= 50000;
    case "momentum":
      return liq >= 10000 && vol24 >= 5000 && mcap <= 200000;
    case "lowCap":
      return liq >= 20000 && vol24 >= 2000 && mcap <= 100000;
    case "trending":
      return liq >= 15000 && vol24 >= 8000 && mcap <= 150000;
  }
}

function matchAge(token: DashboardToken, age: AgeFilter): boolean {
  if (age === "all") return true;
  const ageMin = token.tokenAgeMinutes;
  if (ageMin === undefined) return true; // unknown age — pass through
  const limits: Record<AgeFilter, number> = { all: Infinity, "1h": 60, "6h": 360, "24h": 1440, "72h": 4320 };
  return ageMin <= limits[age];
}

export function DiscoverView({ onOpenDetails }: { onOpenDetails: (token: DashboardToken) => void }) {
  const [tokens, setTokens] = useState<DashboardToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [profile, setProfile] = useState<ProfileFilter>("all");
  const [age, setAge] = useState<AgeFilter>("all");
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const { watched, watch, unwatch } = useWatchlist();

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/degen-hunter/feed?limit=200");
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
    fetchTokens();
    const t = setInterval(fetchTokens, 30_000);
    return () => clearInterval(t);
  }, [fetchTokens]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tokens.filter(t => {
      if (q) {
        const name = (t.name ?? "").toLowerCase();
        const sym = (t.symbol ?? "").toLowerCase();
        const addr = (t.contractAddress ?? "").toLowerCase();
        if (!name.includes(q) && !sym.includes(q) && !addr.includes(q)) return false;
      }
      if (!matchProfile(t, profile)) return false;
      if (!matchAge(t, age)) return false;
      return true;
    });
  }, [tokens, search, profile, age]);

  // Count per profile (for display)
  const profileCounts = useMemo(() => {
    const counts: Partial<Record<ProfileFilter, number>> = {};
    for (const p of ["all", "newMeme", "momentum", "lowCap", "trending"] as ProfileFilter[]) {
      counts[p] = tokens.filter(t => matchProfile(t, p)).length;
    }
    return counts;
  }, [tokens]);

  // Stats from visible tokens
  const stats = useMemo(() => {
    const noAge = filtered.filter(t => t.tokenAgeMinutes === undefined).length;
    const fresh = filtered.filter(t => t.tokenAgeMinutes !== undefined && t.tokenAgeMinutes < 60).length;
    const old = filtered.filter(t => t.tokenAgeMinutes !== undefined && t.tokenAgeMinutes > 1440).length;
    return { noAge, fresh, old };
  }, [filtered]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconFlame className="text-orange-500" size={20} />
          <h2 className="text-lg font-bold text-slate-200">Discover</h2>
          <span className="ml-1 text-sm text-slate-500">({filtered.length} tokens)</span>
        </div>
        <div className="flex items-center gap-2">
          {lastFetch && <span className="hidden text-xs text-slate-600 sm:inline">Updated {lastFetch.toLocaleTimeString()}</span>}
          <button
            onClick={() => { setLoading(true); fetchTokens(); }}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            <IconRefresh size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {/* Freshness warning if age data is missing */}
      {stats.noAge > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-900/30 bg-amber-950/10 p-3 text-xs text-amber-500/80">
          <IconAlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
          <span>{stats.noAge} token{stats.noAge !== 1 ? "s" : ""} have unknown pair age — these may be older tokens where DexScreener did not return a creation timestamp. Use filters to focus on tokens with known age.</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3">
        {/* Search */}
        <div className="relative">
          <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, symbol, address…"
            className="w-full rounded-lg border border-slate-800 bg-slate-900/60 py-2 pl-8 pr-3 text-sm text-slate-300 placeholder-slate-600 outline-none focus:border-slate-600"
          />
        </div>

        {/* Profile filter */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {(["all", "newMeme", "momentum", "lowCap", "trending"] as ProfileFilter[]).map(p => (
            <button
              key={p}
              onClick={() => setProfile(p)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors ${
                profile === p ? "bg-orange-900/60 text-orange-400" : "text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              }`}
            >
              {PROFILE_LABELS[p]}{profileCounts[p] !== undefined ? ` · ${profileCounts[p]}` : ""}
            </button>
          ))}
        </div>

        {/* Age filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-800/60">
          <IconClock size={14} className="text-slate-600 shrink-0" />
          {(["all", "1h", "6h", "24h", "72h"] as AgeFilter[]).map(a => (
            <button
              key={a}
              onClick={() => setAge(a)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors ${
                age === a ? "bg-slate-700 text-white" : "text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              }`}
            >
              {a === "all" ? "Any Age" : `< ${a}`}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && tokens.length === 0 && (
        <div className="flex flex-col gap-3">
          {[1,2,3].map(i => <div key={i} className="h-40 animate-pulse rounded-xl border border-slate-800 bg-slate-900/40" />)}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-xl border border-rose-900/40 bg-rose-950/20 py-8 text-center">
          <p className="text-sm text-rose-400">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 py-16 text-center">
          <IconSearch className="mb-3 text-slate-700" size={28} />
          <p className="font-mono text-sm uppercase tracking-widest text-slate-500">No tokens match your filters</p>
          <button onClick={() => { setSearch(""); setProfile("all"); setAge("all"); }} className="mt-3 text-xs text-orange-500 hover:text-orange-400">
            Clear Filters
          </button>
        </div>
      )}

      {/* Token list */}
      {!error && filtered.length > 0 && (
        <div className="flex flex-col gap-3">
          {filtered.map(token => {
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
