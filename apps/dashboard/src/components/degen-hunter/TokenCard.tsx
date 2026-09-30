"use client";

import { IconEye, IconBan, IconVolumeOff, IconInfoCircle, IconExternalLink } from "@tabler/icons-react";
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

function riskStyle(level: string | undefined) {
  if (level === "high") return "text-rose-400 bg-rose-950/40 border-rose-900/60";
  if (level === "medium") return "text-amber-400 bg-amber-950/40 border-amber-900/60";
  if (level === "low") return "text-emerald-400 bg-emerald-950/40 border-emerald-900/60";
  return "text-slate-400 bg-slate-900/40 border-slate-800";
}

function scoreBg(score: number | undefined) {
  if (score == null) return "text-slate-500";
  if (score >= 70) return "text-emerald-400";
  if (score >= 45) return "text-amber-400";
  return "text-rose-400";
}

function riskLevel(token: DashboardToken): string | undefined {
  const s = token.totalScore;
  if (s == null) return undefined;
  if (s >= 70) return "high";   // high opportunity = not "dangerous" but high signal
  if (s >= 45) return "medium";
  return "low";
}

export function TokenCard({
  token,
  isWatched = false,
  onWatch,
  onIgnore,
  onMute,
  onDetails,
}: {
  token: DashboardToken;
  isWatched?: boolean;
  onWatch?: () => void;
  onIgnore?: () => void;
  onMute?: () => void;
  onDetails?: () => void;
}) {
  const rl = riskLevel(token);

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
          <div className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${riskStyle(rl)}`}>
            {rl ? `${rl} signal` : "Unscored"}
          </div>
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

      {/* Security flags (quick inline) */}
      {(token.mintAuthorityActive || token.freezeAuthorityActive || (token.riskFlags?.length ?? 0) > 0) && (
        <div className="flex flex-wrap gap-1">
          {token.mintAuthorityActive && (
            <span className="rounded bg-rose-950/50 border border-rose-900/40 px-1.5 py-0.5 text-[10px] text-rose-400">⚠ Mint</span>
          )}
          {token.freezeAuthorityActive && (
            <span className="rounded bg-rose-950/50 border border-rose-900/40 px-1.5 py-0.5 text-[10px] text-rose-400">⚠ Freeze</span>
          )}
          {token.riskFlags?.slice(0, 2).map((f) => (
            <span key={f} className="rounded bg-amber-950/30 border border-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400 truncate max-w-[120px]">
              {f}
            </span>
          ))}
          {(token.riskFlags?.length ?? 0) > 2 && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
              +{(token.riskFlags?.length ?? 0) - 2} more
            </span>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-1 flex flex-wrap gap-2">
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
        <button
          onClick={onIgnore}
          className="flex items-center justify-center rounded-lg bg-slate-800 px-3 py-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
          title="Ignore token"
        >
          <IconBan size={14} />
        </button>
        <button
          onClick={onMute}
          className="flex items-center justify-center rounded-lg bg-slate-800 px-3 py-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
          title="Mute alerts"
        >
          <IconVolumeOff size={14} />
        </button>
      </div>
    </div>
  );
}
