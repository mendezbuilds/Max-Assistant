"use client";

import { IconX, IconExternalLink, IconAlertTriangle, IconShield } from "@tabler/icons-react";
import type { DashboardToken } from "./types";
import { TradePanel } from "./TradePanel";
import { useTradable } from "./useTradable";
import { assess, RISK_STYLE } from "./risk";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-800/60 last:border-0">
      <span className="shrink-0 text-xs text-slate-500 font-mono">{label}</span>
      <span className="text-right text-xs text-slate-300 font-mono break-all">{value ?? "—"}</span>
    </div>
  );
}

function ScoreBar({ label, score }: { label: string; score: number | undefined }) {
  if (score == null) return null;
  const color = score >= 70 ? "bg-emerald-500" : score >= 45 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-32 shrink-0 text-xs text-slate-400">{label}</span>
      <div className="flex-1 rounded-full bg-slate-800 h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="w-8 text-right text-xs font-mono text-slate-300">{score}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
      <h3 className="mb-3 font-mono text-xs font-bold uppercase tracking-widest text-slate-400">{title}</h3>
      {children}
    </div>
  );
}

function fmtPrice(n: number | undefined) {
  if (n == null) return "—";
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  if (n < 1) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

function fmtUsd(n: number | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtAge(minutes: number | undefined) {
  if (minutes == null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

function Authority({ active, label }: { active: boolean | undefined; label: string }) {
  if (active == null) return <span className="text-slate-500">Not checked</span>;
  return active
    ? <span className="text-rose-400">⚠ Active ({label})</span>
    : <span className="text-emerald-400">✓ Renounced</span>;
}

export function TokenDetailPanel({
  token,
  closing,
  onClose,
}: {
  token: DashboardToken | null;
  closing: boolean;
  onClose: () => void;
}) {
  // Can Jupiter route a buy of this token right now? Warn above the Buy box if not.
  const mint = token?.contractAddress ?? "";
  const route = useTradable(mint ? [mint] : [])[mint];
  // Risk level, flags, warnings and evidence from the one shared assessment (the level is derived from the flags).
  const risk = token ? assess(token) : null;
  return (
    <div
      className={`fixed right-0 top-0 z-40 h-full w-full max-w-sm overflow-hidden border-l border-slate-800 bg-slate-950/97 shadow-2xl backdrop-blur-md sm:max-w-md transition-transform duration-300 ${
        closing ? "translate-x-full" : "translate-x-0"
      }`}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          {token?.logoUrl && (
            <img src={token.logoUrl} alt="" className="h-7 w-7 rounded-full object-cover bg-slate-800 shrink-0" />
          )}
          <h2 className="font-bold text-slate-200 truncate">
            {token?.name ?? "Token Analysis"}
          </h2>
          {token?.symbol && (
            <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">${token.symbol}</span>
          )}
        </div>
        <button onClick={onClose} aria-label="Close panel" className="ml-2 shrink-0 text-slate-500 hover:text-slate-200">
          <IconX size={18} />
        </button>
      </div>

      {/* Panel body */}
      <div className="h-[calc(100%-53px)] overflow-y-auto p-4">
        {!token ? (
          <div className="flex h-full items-center justify-center text-slate-500 text-sm">
            No token selected
          </div>
        ) : (
          <div className="flex flex-col gap-4">

            {/* Trading */}
            {route && !route.tradable && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-300">
                <IconAlertTriangle size={15} className="mt-0.5 shrink-0" />
                <p>
                  <span className="font-bold">Not tradable yet.</span> {route.reason} A buy will fail until Jupiter can route it.
                </p>
              </div>
            )}
            {route?.tradable && route.priceImpactPct != null && route.priceImpactPct >= 5 && (
              <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-300">
                Heavy price impact (~{route.priceImpactPct.toFixed(1)}% on a 0.01 SOL buy): thin liquidity, so expect to get a worse price than shown.
              </div>
            )}
            <TradePanel token={token} />

            {/* 1. Market Data */}
            <Section title="Market">
              <Row label="Price" value={fmtPrice(token.priceUsd)} />
              <Row label="Market Cap" value={fmtUsd(token.marketCapUsd)} />
              <Row label="FDV" value={fmtUsd(token.fdvUsd)} />
              <Row label="Liquidity" value={fmtUsd(token.liquidityUsd)} />
              <Row label="Volume 24h" value={fmtUsd(token.volume24hUsd)} />
              <Row label="Volume 1h" value={fmtUsd(token.volume1hUsd)} />
              <Row label="Buys 24h" value={token.buys24h?.toLocaleString()} />
              <Row label="Sells 24h" value={token.sells24h?.toLocaleString()} />
              <Row label="Token Age" value={fmtAge(token.tokenAgeMinutes)} />
              <Row label="24h Change" value={token.priceChange24h != null ? `${token.priceChange24h > 0 ? "+" : ""}${token.priceChange24h.toFixed(2)}%` : undefined} />
            </Section>

            {/* 2. Score Breakdown */}
            <Section title="Score Breakdown">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">Total Score</span>
                <span className={`font-mono text-lg font-bold ${
                  (token.totalScore ?? 0) >= 70 ? "text-emerald-400"
                  : (token.totalScore ?? 0) >= 45 ? "text-amber-400"
                  : "text-rose-400"
                }`}>
                  {token.totalScore ?? "—"}<span className="text-xs text-slate-500">/100</span>
                </span>
              </div>
              <div className="flex flex-col gap-0.5 mt-3">
                <ScoreBar label="Liquidity" score={token.liquidityScore} />
                <ScoreBar label="Volume" score={token.volumeScore} />
                <ScoreBar label="Buy/Sell" score={token.buySellScore} />
                <ScoreBar label="Momentum" score={token.momentumScore} />
                <ScoreBar label="Community" score={token.communityScore} />
                <ScoreBar label="Contract Safety" score={token.contractSafetyScore} />
                <ScoreBar label="Social Activity" score={token.socialActivityScore} />
                <ScoreBar label="Data Confidence" score={token.dataScore} />
              </div>
            </Section>

            {/* 3. Risk Analysis */}
            <Section title="Risk Analysis">
              <Row label="Risk Score" value={token.riskScore != null ? `${token.riskScore}/100` : undefined} />
              <Row label="Honeypot" value={
                token.honeypotStatus === "safe-looking" ? <span className="text-emerald-400">Safe-looking</span>
                : token.honeypotStatus === "honeypot-risk" ? <span className="text-rose-400">⚠ Honeypot Risk</span>
                : token.honeypotStatus === "suspicious" ? <span className="text-amber-400">Suspicious</span>
                : token.honeypotStatus ?? "Not checked"
              } />
              <Row label="Buy Tax" value={token.buyTaxPercent != null ? `${token.buyTaxPercent}%` : undefined} />
              <Row label="Sell Tax" value={token.sellTaxPercent != null ? `${token.sellTaxPercent}%` : undefined} />
              <Row label="Holder Conc." value={token.topHolderConcentration != null ? `${token.topHolderConcentration.toFixed(1)}%` : undefined} />
              <Row label="Dev Holdings" value={token.developerHoldingPercent != null ? `${token.developerHoldingPercent.toFixed(1)}%` : undefined} />
              <Row label="Liquidity Lock" value={
                token.liquidityLocked == null ? "Not checked"
                : token.liquidityLocked ? <span className="text-emerald-400">✓ Locked{token.liquidityLockDetails ? ` (${token.liquidityLockDetails})` : ""}</span>
                : <span className="text-rose-400">⚠ Unlocked</span>
              } />

              {/* Risk level — derived from the flags below, so it always has its reasons */}
              {risk && (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                  <span className="text-xs text-slate-500 font-mono">Risk level</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${RISK_STYLE[(risk.level.toUpperCase() as keyof typeof RISK_STYLE)]}`}>
                    {risk.level}{risk.level === "low" && risk.limitedChecks ? " · limited checks" : ""}
                  </span>
                </div>
              )}

              {/* Risk flags */}
              {risk && risk.riskFlags.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs text-slate-500 font-mono">Flags</p>
                  <div className="flex flex-wrap gap-1">
                    {risk.riskFlags.map((f) => (
                      <span key={f} className="rounded bg-rose-950/50 border border-rose-900/40 px-1.5 py-0.5 text-[10px] text-rose-400">
                        <IconAlertTriangle size={10} className="inline mr-0.5" />{f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {risk && risk.warnings.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs text-slate-500 font-mono">Warnings</p>
                  <ul className="flex flex-col gap-1">
                    {risk.warnings.map((w, i) => (
                      <li key={i} className="text-xs text-amber-400">• {w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Evidence */}
              {risk && risk.evidence.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs text-slate-500 font-mono">Evidence</p>
                  <ul className="flex flex-col gap-1">
                    {risk.evidence.map((e, i) => (
                      <li key={i} className="text-xs text-slate-400">• {e}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* What could NOT be checked: "no flag" on these means unknown, not fine */}
              {risk && risk.unverified.length > 0 && (
                <p className="mt-3 text-[11px] leading-snug text-slate-500">
                  ℹ Not verified: {risk.unverified.join(", ")}. No flag on these means unknown, not safe.
                </p>
              )}
            </Section>

            {/* 4. Contract */}
            <Section title="Contract">
              <Row label="Chain" value={token.chain} />
              <Row label="Status" value={token.status} />
              <Row label="Mint Auth." value={<Authority active={token.mintAuthorityActive} label="Mint" />} />
              <Row label="Freeze Auth." value={<Authority active={token.freezeAuthorityActive} label="Freeze" />} />
              <Row label="Verified" value={
                token.contractVerified == null ? "Not checked"
                : token.contractVerified ? <span className="text-emerald-400">✓ Verified</span>
                : <span className="text-amber-400">Unverified</span>
              } />
              <Row label="Ownership" value={
                token.ownershipRenounced == null ? "Not checked"
                : token.ownershipRenounced ? <span className="text-emerald-400">✓ Renounced</span>
                : <span className="text-amber-400">Not renounced</span>
              } />
              {token.contractAddress && (
                <Row label="Address" value={
                  <span className="truncate max-w-[160px] block text-right font-mono text-slate-400">
                    {token.contractAddress.slice(0, 8)}…{token.contractAddress.slice(-6)}
                  </span>
                } />
              )}
              {token.pairAddress && (
                <Row label="Pair" value={
                  <span className="truncate max-w-[160px] block text-right font-mono text-slate-400">
                    {token.pairAddress.slice(0, 8)}…{token.pairAddress.slice(-6)}
                  </span>
                } />
              )}
            </Section>

            {/* 5. Social / Source */}
            <Section title="Source & Links">
              <Row label="Discovered via" value={token.discoverySource} />
              <Row label="Discovered at" value={token.discoveredAt ? new Date(token.discoveredAt).toLocaleString() : undefined} />
              <Row label="Last updated" value={token.lastUpdatedAt ? new Date(token.lastUpdatedAt).toLocaleString() : undefined} />
              {token.websiteUrl && (
                <a
                  href={token.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded mt-2 bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-700 transition-colors"
                >
                  <IconExternalLink size={12} /> Website
                </a>
              )}
              {token.chartUrl && (
                <a
                  href={token.chartUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded mt-2 bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-700 transition-colors"
                >
                  <IconExternalLink size={12} /> Chart
                </a>
              )}
              {token.explorerUrl && (
                <a
                  href={token.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded mt-2 bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-700 transition-colors"
                >
                  <IconExternalLink size={12} /> Explorer
                </a>
              )}
              {(token.socialLinks?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {token.socialLinks!.map((link, i) => (
                    <a
                      key={i}
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-700 transition-colors truncate"
                    >
                      <IconExternalLink size={12} /> {link}
                    </a>
                  ))}
                </div>
              )}
            </Section>

          </div>
        )}
      </div>
    </div>
  );
}
