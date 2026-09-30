"use client";

import { IconEye, IconRefresh, IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { useWatchlist } from "./useWatchlist";
import { TokenCard } from "./TokenCard";
import type { DashboardToken } from "./types";

export function WatchlistView({ onOpenDetails }: { onOpenDetails: (token: DashboardToken) => void }) {
  const { watched, notMapped, error, loading, unwatch, refresh } = useWatchlist();

  // We need the full token data, not just addresses. Re-fetch from feed to find matching tokens.
  // This is handled by the API which returns enriched entries with tokenData.
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);

  async function fetchEntries() {
    setFetching(true);
    try {
      const res = await fetch("/api/agents/degen-hunter/watchlist");
      if (res.status === 401) { setFetching(false); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries(data.watchlist ?? []);
      setFetchError(null);
    } catch (e: any) {
      setFetchError(e?.message ?? "Error");
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => { fetchEntries(); }, []);

  const handleRefresh = () => {
    refresh();
    fetchEntries();
  };

  if (notMapped) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-amber-900/40 bg-amber-950/10 py-12 text-center">
        <IconAlertTriangle className="mb-3 text-amber-500" size={28} />
        <p className="font-mono text-sm font-medium text-amber-400">Account not connected</p>
        <p className="mt-2 max-w-sm text-xs text-amber-600/80">
          Set <code className="rounded bg-slate-800 px-1 text-slate-300">DEGEN_OWNER_CHAT_ID</code> in{" "}
          <code className="rounded bg-slate-800 px-1 text-slate-300">.env</code> to your Telegram chatId to link your bot watchlist.
          Message <code className="rounded bg-slate-800 px-1 text-slate-300">@userinfobot</code> on Telegram to find your ID.
        </p>
      </div>
    );
  }

  if ((fetchError || error) && !fetching) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-rose-900/40 bg-rose-950/10 py-12 text-center">
        <p className="font-mono text-sm text-rose-400">{fetchError ?? error}</p>
        <button onClick={handleRefresh} className="mt-3 rounded bg-slate-800 px-4 py-2 text-xs text-slate-200 hover:bg-slate-700">Retry</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-200">
          Watchlist <span className="ml-1 text-sm font-normal text-slate-500">({entries.length})</span>
        </h2>
        <button
          onClick={handleRefresh}
          disabled={fetching || loading}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-50"
        >
          <IconRefresh size={14} className={fetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {fetching && entries.length === 0 && (
        <div className="flex flex-col gap-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-slate-800 bg-slate-900/40" />
          ))}
        </div>
      )}

      {!fetching && entries.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 border-dashed py-16 text-center">
          <IconEye className="mb-3 text-slate-700" size={28} />
          <p className="font-mono text-sm font-medium uppercase tracking-widest text-slate-500">Watchlist is empty</p>
          <p className="mt-1 text-xs text-slate-600">Use the Watch button on any token card to add it here.</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="flex flex-col gap-3">
          {entries.map((entry) => {
            const tokenAddress = entry.tokenAddress;
            const td = entry.tokenData;

            if (!td) {
              // Minimal display when token data is unavailable
              return (
                <div key={tokenAddress} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                  <div>
                    <p className="font-mono text-sm text-slate-400">{tokenAddress.slice(0, 8)}…{tokenAddress.slice(-6)}</p>
                    <p className="text-xs text-slate-600 mt-0.5">No cached data</p>
                  </div>
                  <button
                    onClick={() => unwatch(tokenAddress)}
                    className="rounded bg-slate-800 px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-950/50"
                  >
                    Unwatch
                  </button>
                </div>
              );
            }

            const token: DashboardToken = {
              _rowId: 0,
              _updatedAt: entry.addedAt,
              tokenId: tokenAddress,
              ...td,
            };

            return (
              <TokenCard
                key={tokenAddress}
                token={token}
                onDetails={() => onOpenDetails(token)}
                onWatch={() => unwatch(tokenAddress)}
                onIgnore={undefined}
                onMute={undefined}
                isWatched={true}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface WatchlistEntry {
  tokenAddress: string;
  addedAt: string;
  tokenData: Record<string, unknown> | null;
}

// Need to import useState and useEffect
import { useState, useEffect } from "react";
