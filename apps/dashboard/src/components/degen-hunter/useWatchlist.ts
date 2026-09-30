"use client";

import { useState, useEffect, useCallback } from "react";

export interface WatchlistState {
  /** Set of tokenAddresses currently on the watchlist */
  watched: Set<string>;
  /** Count, for display */
  count: number;
  /** Is identity not mapped (DEGEN_OWNER_CHAT_ID not set)? */
  notMapped: boolean;
  /** Any fetch error */
  error: string | null;
  loading: boolean;
  /** Add a token by address */
  watch: (tokenAddress: string) => Promise<void>;
  /** Remove a token by address */
  unwatch: (tokenAddress: string) => Promise<void>;
  /** Refresh from server */
  refresh: () => Promise<void>;
}

export function useWatchlist(): WatchlistState {
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(0);
  const [notMapped, setNotMapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agents/degen-hunter/watchlist");
      if (res.status === 401) {
        const data = await res.json();
        if (data?.error === "identity_not_mapped") {
          setNotMapped(true);
          setLoading(false);
          return;
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const addresses = (data.watchlist ?? []).map((w: any) => w.tokenAddress as string);
      setWatched(new Set(addresses));
      setCount(data.count ?? 0);
      setNotMapped(false);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const watch = useCallback(async (tokenAddress: string) => {
    // Optimistic update
    setWatched((prev) => new Set([...prev, tokenAddress]));
    setCount((c) => c + 1);
    try {
      const res = await fetch("/api/agents/degen-hunter/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenAddress }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      // Rollback on failure
      setWatched((prev) => {
        const next = new Set(prev);
        next.delete(tokenAddress);
        return next;
      });
      setCount((c) => Math.max(0, c - 1));
      setError(`Failed to add to watchlist: ${e?.message}`);
    }
  }, []);

  const unwatch = useCallback(async (tokenAddress: string) => {
    // Optimistic update
    setWatched((prev) => {
      const next = new Set(prev);
      next.delete(tokenAddress);
      return next;
    });
    setCount((c) => Math.max(0, c - 1));
    try {
      const res = await fetch(
        `/api/agents/degen-hunter/watchlist/${encodeURIComponent(tokenAddress)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      // Rollback on failure
      setWatched((prev) => new Set([...prev, tokenAddress]));
      setCount((c) => c + 1);
      setError(`Failed to remove from watchlist: ${e?.message}`);
    }
  }, []);

  return { watched, count, notMapped, error, loading, watch, unwatch, refresh };
}
