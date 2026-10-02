"use client";

import { useEffect, useState } from "react";

export interface TradableInfo {
  tradable: boolean;
  reason?: string;
  priceImpactPct?: number;
}

const POLL_MS = 60_000;

/**
 * Whether Jupiter can route a buy of each given token, kept fresh every minute (a
 * new token usually becomes tradable within minutes of launch). Tokens whose status
 * couldn't be determined are simply absent from the result.
 */
export function useTradable(mints: string[]): Record<string, TradableInfo> {
  const [info, setInfo] = useState<Record<string, TradableInfo>>({});
  const key = [...new Set(mints.filter(Boolean))].sort().join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetch(`/api/agents/degen-hunter/tradable?mints=${encodeURIComponent(key)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => !cancelled && d?.tradable && setInfo((prev) => ({ ...prev, ...d.tradable })))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [key]);

  return info;
}

/** Small status pill: green when Jupiter can route it, amber when it can't (yet). Nothing while unknown. */
export function TradableBadge({ info }: { info: TradableInfo | undefined }) {
  if (!info) return null;
  return info.tradable ? (
    <span className="rounded-full border border-emerald-900/60 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400" title="Jupiter can route a buy of this token right now">
      ✓ Tradable
    </span>
  ) : (
    <span className="rounded-full border border-amber-900/60 bg-amber-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400" title={info.reason}>
      ⏳ Not tradable yet
    </span>
  );
}
