"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ALERT_FADE_MS,
  ALERT_MAX_VISIBLE,
  ALERT_POLL_MS,
  ALERT_TTL_MS,
  EXIT_MULTIPLE,
  TRACKING_MIN_MULTIPLE,
  TRACKING_STEP,
} from "@/lib/degen-alert-config";
import { riskTag, tokenWarnings, type RiskTag } from "./risk";
import type { DashboardToken } from "./types";

export type LiveAlertKind = "signal" | "tracking" | "exit";

export interface LiveAlert {
  id: string;
  kind: LiveAlertKind;
  symbol: string;
  title: string;
  /** When the underlying event happened (ms). */
  at: number;
  /** When this card removes itself from the live view (ms). */
  expiresAt: number;
  /** When this card first appeared on screen (ms). Drives its rise from the bottom; distinct from `at`, which can be older than arrival. */
  shownAt: number;
  /** True during the final fade-out, before removal. */
  leaving: boolean;
  token?: DashboardToken;
  // signal
  chain?: string;
  ageMinutes?: number;
  marketCap?: number;
  liquidity?: number;
  volume?: number;
  score?: number;
  risk?: RiskTag;
  warnings?: string[];
  // tracking / exit
  entryMarketCap?: number | null;
  currentMarketCap?: number | null;
  multiple?: number | null;
  /** Set when the alert is about a watchlist token (not an open position). */
  watchlist?: boolean;
  /** Watchlist token judged rugged; tracking has stopped. */
  rugged?: boolean;
}

interface WatchMark {
  tokenAddress: string;
  symbol: string;
  multiple: number | null;
  rugged: boolean;
  currentMarketCapUsd: number | null;
  entryMarketCapUsd: number | null;
}

interface PositionMark {
  tokenAddress: string;
  tokenSymbol: string;
  status: string;
  currentMarketCapUsd: number | null;
  entryMarketCapUsd: number | null;
  multiple: number | null;
}

/**
 * Streams Degen Hunter's three alert types — new signals, tracking updates on
 * open positions, and exit signals — as a transient list.
 *
 * Display-only: each card removes itself ALERT_TTL_MS after its event, and the
 * list is capped at ALERT_MAX_VISIBLE (oldest pushed out first). Nothing here
 * writes or deletes data — the token feed, positions and ActivityLog are the
 * permanent record. Ids already shown are remembered for the session so an
 * expired card never re-appears on the next poll.
 *
 * Lives above both views that render it (the orbit sidebar and the dedicated
 * screen) so navigating between them doesn't reset the stream.
 */
const SEEN_KEY = "degen-live-alerts-seen";
function loadSeen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
  } catch { /* private mode etc. — fine, it just won't survive a refresh */ }
}

export function useLiveAlerts(): { alerts: LiveAlert[]; dismiss: (id: string) => void } {
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  // Remembered across page refreshes too (these cards are derived from current state, so without this every refresh
  // re-announced everything that was already shown). Capped so it can't grow forever.
  const seen = useRef<Set<string>>(new Set(loadSeen()));

  const poll = useCallback(async () => {
    const now = Date.now();
    const fresh: LiveAlert[] = [];
    let tokens: DashboardToken[] = [];

    try {
      const res = await fetch("/api/agents/degen-hunter/feed?limit=30");
      if (res.ok) tokens = ((await res.json()).tokens ?? []) as DashboardToken[];
    } catch { /* non-fatal */ }

    // New signals — first sighting of a token, skipping anything already older than the TTL (stale on arrival).
    for (const t of tokens) {
      const id = `sig_${t.tokenId}`;
      if (seen.current.has(id)) continue;
      seen.current.add(id);
      const at = Date.parse(t._updatedAt) || now;
      if (now - at >= ALERT_TTL_MS) continue;
      fresh.push({
        id,
        kind: "signal",
        symbol: t.symbol ?? "Token",
        title: t.name ?? t.symbol ?? "New token",
        at,
        expiresAt: at + ALERT_TTL_MS,
        shownAt: now,
        leaving: false,
        token: t,
        chain: t.chain,
        ageMinutes: t.tokenAgeMinutes,
        marketCap: t.marketCapUsd,
        liquidity: t.liquidityUsd,
        volume: t.volume24hUsd,
        score: t.totalScore,
        risk: riskTag(t),
        warnings: tokenWarnings(t),
      });
    }

    // Tracking updates + exit signals — derived from real open-position marks. Detected "now", since a mark is the position's current state.
    try {
      const res = await fetch("/api/agents/degen-hunter/position-marks");
      if (res.ok) {
        const body = await res.json();
        const marks = (body.marks ?? []) as PositionMark[];

        // Watchlist tokens: X milestones, drops, and rugs, from core's last scan.
        for (const w of (body.watch ?? []) as WatchMark[]) {
          const token = tokens.find((t) => t.contractAddress === w.tokenAddress || t.tokenId === w.tokenAddress);
          const base = {
            symbol: w.symbol,
            title: w.symbol,
            at: now,
            expiresAt: now + ALERT_TTL_MS,
            shownAt: now,
            leaving: false,
            token,
            entryMarketCap: w.entryMarketCapUsd,
            currentMarketCap: w.currentMarketCapUsd,
            multiple: w.multiple,
            watchlist: true,
          };
          if (w.rugged) {
            const id = `wrug_${w.tokenAddress}`;
            if (!seen.current.has(id)) {
              seen.current.add(id);
              fresh.push({ ...base, id, kind: "exit", rugged: true });
            }
          } else if (w.multiple != null && w.multiple >= TRACKING_MIN_MULTIPLE) {
            const id = `wtk_${w.tokenAddress}_${(Math.floor(w.multiple / TRACKING_STEP) * TRACKING_STEP).toFixed(1)}`;
            if (!seen.current.has(id)) {
              seen.current.add(id);
              fresh.push({ ...base, id, kind: "tracking" });
            }
          } else if (w.multiple != null && w.multiple <= EXIT_MULTIPLE) {
            const id = `wexit_${w.tokenAddress}`; // once per token: a price wobbling around the line must not re-announce it
            if (!seen.current.has(id)) {
              seen.current.add(id);
              fresh.push({ ...base, id, kind: "exit" });
            }
          }
        }

        for (const m of marks) {
          if (m.status !== "OPEN" || m.multiple == null) continue;
          const token = tokens.find((t) => t.contractAddress === m.tokenAddress || t.tokenId === m.tokenAddress);
          const base = {
            symbol: m.tokenSymbol,
            at: now,
            expiresAt: now + ALERT_TTL_MS,
            shownAt: now,
            leaving: false,
            token,
            entryMarketCap: m.entryMarketCapUsd,
            currentMarketCap: m.currentMarketCapUsd,
            multiple: m.multiple,
          };
          if (m.multiple <= EXIT_MULTIPLE) {
            const id = `exit_${m.tokenAddress}`; // once per token, same reason
            if (!seen.current.has(id)) {
              seen.current.add(id);
              fresh.push({ ...base, id, kind: "exit", title: m.tokenSymbol });
            }
          } else if (m.multiple >= TRACKING_MIN_MULTIPLE) {
            const bucket = Math.floor(m.multiple / TRACKING_STEP) * TRACKING_STEP;
            const id = `trk_${m.tokenAddress}_${bucket.toFixed(1)}`;
            if (!seen.current.has(id)) {
              seen.current.add(id);
              fresh.push({ ...base, id, kind: "tracking", title: m.tokenSymbol });
            }
          }
        }
      }
    } catch { /* non-fatal */ }

    saveSeen(seen.current);
    if (fresh.length === 0) return;
    fresh.sort((a, b) => b.at - a.at);
    setAlerts((prev) => [...fresh, ...prev].slice(0, ALERT_MAX_VISIBLE));
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, ALERT_POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  // Independent per-card expiry: each card fades and removes itself on its own deadline, whether or not anything new has arrived.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setAlerts((prev) => {
        let changed = false;
        const next: LiveAlert[] = [];
        for (const a of prev) {
          if (now >= a.expiresAt) {
            changed = true;
            continue;
          }
          const leaving = now >= a.expiresAt - ALERT_FADE_MS;
          if (leaving !== a.leaving) {
            changed = true;
            next.push({ ...a, leaving });
          } else {
            next.push(a);
          }
        }
        return changed ? next : prev;
      });
    }, 250);
    return () => clearInterval(t);
  }, []);

  const dismiss = useCallback((id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id)), []);

  return { alerts, dismiss };
}
