"use client";

import { IconEye, IconBan, IconVolumeOff, IconInfoCircle, IconExternalLink } from "@tabler/icons-react";
import { RISK_STYLE, riskTag, tokenWarnings, tokenUnverified } from "./risk";
import { TradableBadge, type TradableInfo } from "./useTradable";
import type { DashboardToken } from "./types";

function fmt(n: number | undefined, decimals = 2, prefix = "") {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${prefix}${(n / 1_000).toFixed(1)}K`;
  return `${prefix}${n.toFixed(decimals)}`;
}

function fmtPrice(n: number | undefined) {
  if (n == null) return "—";
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  if (n < 1) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(2)}`;
}

function fmtAge(minutes: number | undefined) {
  if (minutes == null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}


function scoreBg(score: number | undefined) {
  if (score == null) return "text-slate-500";
  if (score >= 70) return "text-emerald-400";
  if (score >= 45) return "text-amber-400";
  return "text-rose-400";
}


export function TokenCard({
  token,
  isWatched = false,
  onWatch,
  onIgnore,
  onMute,
  onDetails,
  onBuy,
  tradable,
}: {
  token: DashboardToken;
  isWatched?: boolean;
  onWatch?: () => void;
  /** Ignore / Mute buttons only render when a handler is supplied, so no card ever shows a button that does nothing. */
  onIgnore?: () => void;
  onMute?: () => void;
  onDetails?: () => void;
  /** Opens the token's trade panel (the Buy box lives in the details panel). */
  onBuy?: () => void;
  /** Whether Jupiter can route a buy right now; shows a badge when known. */
  tradable?: TradableInfo;
}) {
  // The score (top right) is OPPORTUNITY; the pill is RISK, from the shared assessment. These used to
  // be one thing — "high signal" shown in red from the same score — so a good token looked dangerous.
  const risk = riskTag(token);
  const reasons = tokenWarnings(token);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 transition-colors hover:border-slate-700">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          {token.logoUrl ? (
            <img src={token.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover bg-slate-800" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800 font-bold text-slate-300 text-sm">
              {(token.symbol ?? "?").slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-slate-200 truncate">{token.name ?? "Unknown Token"}</h3>
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-medium text-slate-400 shrink-0">
                ${token.symbol ?? "—"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
              <span className="capitalize">{token.chain ?? "—"}</span>
              {token.tokenAgeMinutes != null && (
                <>
                  <span>•</span>
                  <span>{fmtAge(token.tokenAgeMinutes)} old</span>
                </>
              )}
              {token.discoverySource && (
                <>
                  <span>•</span>
                  <span className="capitalize">{token.discoverySource}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className={`text-lg font-bold font-mono ${scoreBg(token.totalScore)}`}>
            {token.totalScore ?? "—"}<span className="text-xs text-slate-500">/100</span>
          </div>
          <div className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${RISK_STYLE[risk ?? "NONE"]}`}>
            {risk ? `${risk} risk` : "Unscored"}
          </div>
          <TradableBadge info={tradable} />
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-950/50 p-2">
          <div className="text-xs text-slate-500">Price</div>
          <div className="font-mono text-sm text-slate-300">{fmtPrice(token.priceUsd)}</div>
        </div>
        <div className="rounded-lg bg-slate-950/50 p-2">
          <div className="text-xs text-slate-500">Liquidity</div>
          <div className="font-mono text-sm text-slate-300">{fmt(token.liquidityUsd, 0, "$")}</div>
        </div>
        <div className="rounded-lg bg-slate-950/50 p-2">
          <div className="text-xs text-slate-500">Vol 24h</div>
          <div className="font-mono text-sm text-slate-300">{fmt(token.volume24hUsd, 0, "$")}</div>
        </div>
        <div className="rounded-lg bg-slate-950/50 p-2">
          <div className="text-xs text-slate-500">Mkt Cap</div>
          <div className="font-mono text-sm text-slate-300">{fmt(token.marketCapUsd, 0, "$")}</div>
        </div>
      </div>

      {/* Why the risk pill says what it says: the reasons behind the level (each has the real numbers). */}
      {reasons.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {reasons.slice(0, 2).map((w) => (
            <p key={w} className="text-[11px] leading-snug text-amber-400/90">⚠ {w}</p>
          ))}
          {reasons.length > 2 && <p className="text-[10px] text-slate-500">+{reasons.length - 2} more in Details</p>}
        </div>
      )}
      {/* What couldn't be checked: "no flag" on these means unknown, not safe */}
      {tokenUnverified(token).length > 0 && (
        <p className="text-[10px] leading-snug text-slate-600">ℹ Not verified: {tokenUnverified(token).join(", ")}</p>
      )}

      {/* Action Buttons */}
      <div className="mt-1 flex flex-wrap gap-2">
        {onBuy && (
          <button
            onClick={onBuy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-orange-600 py-1.5 text-xs font-bold text-white transition-colors hover:bg-orange-500"
          >
            Buy
          </button>
        )}
        <button
          onClick={onDetails}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700"
        >
          <IconInfoCircle size={14} /> Details
        </button>
        <button
          onClick={onWatch}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors ${
            isWatched
              ? "bg-emerald-900/40 text-emerald-400 hover:bg-rose-900/30 hover:text-rose-400"
              : "bg-slate-800 text-slate-200 hover:bg-emerald-900/50 hover:text-emerald-400"
          }`}
        >
          <IconEye size={14} /> {isWatched ? "Watching" : "Watch"}
        </button>
        {token.chartUrl && (
          <a
            href={token.chartUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center rounded-lg bg-slate-800 px-3 py-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
            title="Open chart"
          >
            <IconExternalLink size={14} />
          </a>
        )}
        {onIgnore && (
          <button
            onClick={onIgnore}
            className="flex items-center justify-center rounded-lg bg-slate-800 px-3 py-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
            title="Ignore token (hide it from Discover)"
          >
            <IconBan size={14} />
          </button>
        )}
        {onMute && (
          <button
            onClick={onMute}
            className="flex items-center justify-center rounded-lg bg-slate-800 px-3 py-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
            title="Mute alerts"
          >
            <IconVolumeOff size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
