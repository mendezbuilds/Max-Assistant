"use client";

import { useCallback, useEffect, useState } from "react";
import { IconArrowUpRight } from "@tabler/icons-react";
import { RUG_MULTIPLE } from "@/lib/degen-alert-config";
import { RISK_STYLE, fmtAgeMin, fmtUsd, riskTag, tokenWarnings } from "./risk";
import { useWatchlist } from "./useWatchlist";
import { useTradable, TradableBadge } from "./useTradable";
import type { DashboardToken } from "./types";

interface Mark {
  id: number;
  tokenAddress: string;
  tokenSymbol: string;
  status: string;
  amountSOL: number;
  multiple: number | null;
  partial?: boolean;
  unrealizedSOL?: number | null;
  realized?: { multiple: number; pnlSOL: number; pnlPct: number } | null;
}

interface WalletSummary {
  address: string | null;
  balanceSol: number;
  solUsd: number | null;
}

const POLL_MS = 30_000;

export function OverviewTab({
  onOpenDetails,
  onOpenWalletSend,
}: {
  onOpenDetails: (token: DashboardToken) => void;
  onOpenWalletSend: () => void;
}) {
  const [tokens, setTokens] = useState<DashboardToken[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [marks, setMarks] = useState<Mark[] | null>(null);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const { watched, count: watchCount, notMapped, watch, unwatch } = useWatchlist();

  const load = useCallback(async () => {
    const [feed, mk, w, ig] = await Promise.allSettled([
      fetch("/api/agents/degen-hunter/feed?limit=12").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/agents/degen-hunter/position-marks").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/agents/degen-hunter/wallet").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/agents/degen-hunter/ignore").then((r) => (r.ok ? r.json() : null)),
    ]);
    if (feed.status === "fulfilled" && feed.value) {
      setTokens(feed.value.tokens ?? []);
      setTotal(feed.value.total ?? feed.value.count ?? null);
    }
    if (mk.status === "fulfilled" && mk.value) setMarks(mk.value.marks ?? []);
    if (w.status === "fulfilled" && w.value) setWallet({ address: w.value.address ?? null, balanceSol: w.value.balanceSol ?? 0, solUsd: w.value.solUsd ?? null });
    if (ig.status === "fulfilled" && ig.value) setIgnored(new Set(ig.value.ignored ?? []));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const ignore = async (t: DashboardToken) => {
    const addr = t.contractAddress ?? t.tokenId;
    setIgnored((prev) => new Set([...prev, addr])); // optimistic
    const res = await fetch("/api/agents/degen-hunter/ignore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenAddress: addr }),
    }).catch(() => null);
    if (!res?.ok) {
      setIgnored((prev) => {
        const next = new Set(prev);
        next.delete(addr);
        return next;
      });
    }
  };

  const open = (marks ?? []).filter((m) => m.status === "OPEN");
  const rugged = open.filter((m) => m.multiple != null && m.multiple <= RUG_MULTIPLE).length;

  // PnL (SOL). Realized comes from closed trades that have a recorded exit; unrealized is the
  // estimate on open positions with a current price (partly-sold ones are excluded — see the
  // position-marks route for why they can't be valued).
  const closedWithPnl = (marks ?? []).filter((m) => m.status === "CLOSED" && m.realized);
  const realizedSOL = closedWithPnl.reduce((sum, m) => sum + (m.realized?.pnlSOL ?? 0), 0);
  const wins = closedWithPnl.filter((m) => (m.realized?.pnlSOL ?? 0) >= 0).length;
  const valued = open.filter((m) => m.unrealizedSOL != null);
  const unrealizedSOL = valued.reduce((sum, m) => sum + (m.unrealizedSOL ?? 0), 0);
  const hasPnl = closedWithPnl.length > 0 || valued.length > 0;
  const sgn = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(4)}`;
  const tone = (n: number) => (n >= 0 ? "text-emerald-400" : "text-rose-400");
  const discovered = tokens.filter((t) => !ignored.has(t.contractAddress ?? t.tokenId)).slice(0, 6);
  // Can Jupiter route a buy of each of these right now? (a "not yet" usually flips within minutes)
  const tradable = useTradable(discovered.map((t) => t.contractAddress ?? ""));

  return (
    <div className="flex flex-col gap-4">
      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tracked" value={total != null ? total.toLocaleString() : "—"} />
        <Stat label="Watching" value={notMapped ? "—" : String(watchCount)} sub={notMapped ? "Account not connected" : undefined} />
        <Stat label="Bought" value={marks ? String(marks.length) : "—"} />
        <Stat label="Rugged" value={marks ? String(rugged) : "—"} danger={rugged > 0} sub={`positions down ${Math.round((1 - RUG_MULTIPLE) * 100)}%+`} />
      </div>

      {/* PnL summary */}
      <Panel title="PnL">
        {!hasPnl ? (
          <p className="text-xs text-slate-600">{marks ? "No trades with a recorded result yet. Close a position and its PnL shows up here." : "Loading…"}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <PnlStat label="Realized" value={`${sgn(realizedSOL)} SOL`} className={tone(realizedSOL)} sub={`${closedWithPnl.length} closed`} />
            <PnlStat label="Unrealized (est.)" value={`${sgn(unrealizedSOL)} SOL`} className={tone(unrealizedSOL)} sub={`${valued.length} open`} />
            <PnlStat label="Total" value={`${sgn(realizedSOL + unrealizedSOL)} SOL`} className={tone(realizedSOL + unrealizedSOL)} />
            <PnlStat
              label="Win rate"
              value={closedWithPnl.length ? `${Math.round((wins / closedWithPnl.length) * 100)}%` : "—"}
              className="text-slate-100"
              sub={closedWithPnl.length ? `${wins} of ${closedWithPnl.length}` : undefined}
            />
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Wallet summary */}
        <Panel title="Wallet">
          {wallet?.address ? (
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="flex items-end gap-1.5">
                  <span className="font-mono text-2xl font-bold text-slate-100">{wallet.balanceSol.toFixed(4)}</span>
                  <span className="mb-0.5 text-sm text-[#7fe9a4]">SOL</span>
                </div>
                {wallet.solUsd != null && <p className="font-mono text-xs text-[#7fe9a4]/80">≈ ${(wallet.balanceSol * wallet.solUsd).toFixed(2)}</p>}
              </div>
              <button
                onClick={onOpenWalletSend}
                className="flex items-center gap-1.5 rounded-full border border-[#2a3a30] bg-[#1d2c24] px-3.5 py-1.5 text-xs font-semibold text-[#7fe9a4] transition hover:bg-[#25382d]"
              >
                <IconArrowUpRight size={14} /> Send / Withdraw
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-600">{wallet ? "No burner wallet yet — create one with /wallet in Telegram." : "Loading…"}</p>
          )}
        </Panel>

        {/* Open positions */}
        <Panel title={`Open positions${marks ? ` · ${open.length}` : ""}`}>
          {open.length === 0 ? (
            <p className="text-xs text-slate-600">{marks ? "No open positions." : "Loading…"}</p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-800/70">
              {open.slice(0, 5).map((m) => (
                <div key={m.id} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="font-semibold text-slate-200">{m.tokenSymbol}</span>
                  <span className={`font-mono font-bold ${m.multiple == null ? "text-slate-500" : m.multiple >= 1 ? "text-emerald-400" : "text-rose-400"}`}>
                    {m.multiple == null ? "—" : `${m.multiple.toFixed(2)}×`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Recently discovered */}
      <Panel title="Recently discovered">
        {discovered.length === 0 ? (
          <p className="text-xs text-slate-600">Nothing discovered yet — waiting on the next scan.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {discovered.map((t) => {
              const addr = t.contractAddress ?? t.tokenId;
              const isWatched = watched.has(addr);
              const risk = riskTag(t);
              const warn = tokenWarnings(t)[0];
              return (
                <div key={t.tokenId} className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-200">
                        {t.name ?? t.symbol ?? "Unknown"} {t.symbol && <span className="font-normal text-slate-500">${t.symbol}</span>}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                        {t.chain ?? "—"} · mcap {fmtUsd(t.marketCapUsd)} · liq {fmtUsd(t.liquidityUsd)} · score {t.totalScore ?? "—"}
                        {t.tokenAgeMinutes != null && ` · ${fmtAgeMin(t.tokenAgeMinutes)}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${RISK_STYLE[risk ?? "NONE"]}`}>
                        {risk ?? "Unscored"}
                      </span>
                      <TradableBadge info={tradable[t.contractAddress ?? ""]} />
                    </div>
                  </div>
                  {warn && <p className="text-[11px] text-amber-500">⚠ {warn}</p>}
                  <div className="flex gap-2">
                    {/* Details opens the full token panel (market, security, risk) — look before you watch, buy, or ignore. */}
                    <button onClick={() => onOpenDetails(t)} className="flex-1 rounded-lg border border-slate-600 bg-slate-800/60 py-1.5 text-xs font-medium text-slate-100 transition hover:border-slate-400 hover:bg-slate-700">
                      Details
                    </button>
                    <button onClick={() => onOpenDetails(t)} className="flex-1 rounded-lg bg-orange-600 py-1.5 text-xs font-bold text-white transition hover:bg-orange-500">
                      Buy
                    </button>
                    {/* Toggle: Watch adds it; once watched, the same button removes it (label flips to "Remove" on hover). */}
                    <button
                      onClick={() => (isWatched ? unwatch(addr) : watch(addr))}
                      title={isWatched ? "Remove from watchlist" : "Add to watchlist"}
                      className={`group/watch flex-1 rounded-lg py-1.5 text-xs font-medium transition ${
                        isWatched ? "bg-emerald-900/40 text-emerald-400 hover:bg-rose-900/40 hover:text-rose-300" : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                      }`}
                    >
                      {isWatched ? (
                        <>
                          <span className="group-hover/watch:hidden">✓ Watching</span>
                          <span className="hidden group-hover/watch:inline">✕ Remove</span>
                        </>
                      ) : (
                        "Watch"
                      )}
                    </button>
                    <button onClick={() => ignore(t)} className="flex-1 rounded-lg bg-slate-800 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700">
                      Ignore
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Stat({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3.5">
      <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold ${danger ? "text-rose-400" : "text-slate-100"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-600">{sub}</div>}
    </div>
  );
}

function PnlStat({ label, value, className, sub }: { label: string; value: string; className: string; sub?: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-lg font-bold ${className}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-600">{sub}</div>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-4">
      <h3 className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-400">{title}</h3>
      {children}
    </div>
  );
}
