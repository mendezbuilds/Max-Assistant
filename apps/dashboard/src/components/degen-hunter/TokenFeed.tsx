"use client";

import { useCallback, useEffect, useState } from "react";
import { IconRefresh, IconSearch } from "@tabler/icons-react";
import { TokenCard } from "./TokenCard";
import { useWatchlist } from "./useWatchlist";
import type { DashboardToken } from "./types";

const POLL_MS = 30_000;

export function TokenFeed({ onOpenDetails }: { onOpenDetails: (token: DashboardToken) => void }) {
  const [tokens, setTokens] = useState<DashboardToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const { watched, watch, unwatch, notMapped } = useWatchlist();

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/degen-hunter/feed?limit=50");
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

  // Initial fetch + poll
  useEffect(() => {
    fetchFeed();
    const interval = setInterval(fetchFeed, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchFeed]);

  const handleRefresh = () => {
    setLoading(true);
    fetchFeed();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Feed header */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold text-slate-200">Live Feed</h2>
        <div className="flex items-center gap-3">
          {lastFetch && (
            <span className="hidden text-xs text-slate-500 sm:inline">
              Updated {lastFetch.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-50"
          >
            <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && tokens.length === 0 && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-slate-800 bg-slate-900/40" />
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-rose-900/40 bg-rose-950/20 py-10 text-center">
          <p className="font-mono text-sm text-rose-400">Feed error: {error}</p>
          <button
            onClick={handleRefresh}
            className="mt-3 rounded bg-slate-800 px-4 py-2 text-xs text-slate-200 hover:bg-slate-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && tokens.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 border-dashed py-16 text-center">
          <IconSearch className="mb-3 text-slate-700" size={28} />
          <p className="font-mono text-sm font-medium uppercase tracking-widest text-slate-500">No tokens discovered yet</p>
          <p className="mt-1 text-xs text-slate-600">The Degen Hunter agent will populate this feed when it runs.</p>
        </div>
      )}

      {!error && tokens.length > 0 && (
        <div className="flex flex-col gap-3">
          {tokens.map((token) => {
            const addr = token.contractAddress ?? token.tokenId;
            const isWatched = addr ? watched.has(addr) : false;
            return (
              <TokenCard
                key={token.tokenId ?? token._rowId}
                token={token}
                isWatched={isWatched}
                onDetails={() => onOpenDetails(token)}
                onWatch={addr ? () => (isWatched ? unwatch(addr) : watch(addr)) : undefined}
                onIgnore={() => {/* TODO: Ignore API */}}
                onMute={() => {/* TODO: Mute API */}}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
