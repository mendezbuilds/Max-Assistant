"use client";

import { useState, useEffect, useCallback } from "react";
import { IconBriefcase, IconRefresh, IconPhoto, IconAlertTriangle } from "@tabler/icons-react";
import { TradeCardModal } from "./TradeCardModal";
import { ClosePositionControl } from "./ClosePositionControl";
import type { DashboardToken } from "./types";

/** Per-position PnL from /api/agents/degen-hunter/position-marks. */
interface Mark {
  id: number;
  multiple: number | null;
  /** Open position, partly sold: the value of what's left isn't known, so no PnL is shown. */
  partial: boolean;
  unrealizedSOL: number | null;
  realizedSOL: number;
  hasCard: boolean;
  realized: { multiple: number; pnlSOL: number; pnlPct: number } | null;
}

const signed = (n: number, d = 4) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}`;
const pnlColor = (n: number | null | undefined) => (n == null ? "text-slate-500" : n >= 0 ? "text-emerald-400" : "text-rose-400");

interface Position {
  id: number;
  tokenAddress: string;
  tokenSymbol: string;
  tokenAmount: number;
  amountSOL: number;
  entryPriceUsd: number;
  status: "OPEN" | "CLOSED";
  createdAt: string;
}

interface WalletData {
  status: string;
  positions: Position[];
  recentActivity: Position[];
}

export function PositionsView({ onOpenDetails }: { onOpenDetails: (token: DashboardToken) => void }) {
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [closedPositions, setClosedPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [notMapped, setNotMapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [marks, setMarks] = useState<Map<number, Mark>>(new Map());
  const [card, setCard] = useState<{ id: number; symbol: string } | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/degen-hunter/wallet");
      if (res.status === 401) {
        const data = await res.json();
        if (data?.error === "identity_not_mapped") { setNotMapped(true); setLoading(false); return; }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: WalletData = await res.json();

      setOpenPositions((data.positions ?? []).filter((p) => p.status === "OPEN"));
      setClosedPositions((data.recentActivity ?? []).filter((p) => p.status === "CLOSED"));
      setError(null);
      // PnL is best-effort: the lists render fine without it.
      fetch("/api/agents/degen-hunter/position-marks")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setMarks(new Map((d.marks as Mark[]).map((m) => [m.id, m]))))
        .catch(() => {});
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load once, then keep itself current (skipped while the tab is hidden).
  useEffect(() => {
    fetchPositions();
    const t = setInterval(() => { if (document.visibilityState === "visible") fetchPositions(); }, 30_000);
    return () => clearInterval(t);
  }, [fetchPositions]);

  if (notMapped) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-amber-900/40 bg-amber-950/10 py-12 text-center">
        <IconAlertTriangle className="mb-3 text-amber-500" size={28} />
        <p className="font-mono text-sm font-medium text-amber-400">Account not connected</p>
        <p className="mt-2 max-w-sm text-xs text-amber-600/80">
          Set <code className="rounded bg-slate-800 px-1 text-slate-300">DEGEN_OWNER_CHAT_ID</code> in{" "}
          <code className="rounded bg-slate-800 px-1 text-slate-300">.env</code> to view positions.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconBriefcase className="text-orange-500" size={20} />
          <h2 className="text-lg font-bold text-slate-200">Positions</h2>
        </div>
        <button onClick={() => { setLoading(true); fetchPositions(); }} disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50">
          <IconRefresh size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {loading && (
        <div className="flex flex-col gap-3">
          {[1,2].map(i => <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-800 bg-slate-900/40" />)}
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-rose-900/40 bg-rose-950/20 py-8 text-center">
          <p className="text-sm text-rose-400">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Open positions */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-4">
            <h3 className="mb-4 font-mono text-xs font-bold uppercase tracking-widest text-slate-400">
              Open Positions <span className="text-slate-600">({openPositions.length})</span>
            </h3>
            {openPositions.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-600">No open positions.</p>
                <p className="mt-1 text-xs text-slate-700">Use the Telegram bot&apos;s Buy button on token alerts to open a real trade.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {openPositions.map(pos => (
                  <div key={pos.id} className="flex flex-wrap items-center justify-between gap-y-3 rounded-lg border border-slate-800/60 bg-slate-900/40 p-3">
                    <div>
                      <p className="font-bold text-slate-200">{pos.tokenSymbol}</p>
                      <p className="font-mono text-[10px] text-slate-500">{pos.tokenAddress.slice(0,8)}…{pos.tokenAddress.slice(-6)}</p>
                      <p className="mt-1 text-xs text-slate-500">Entry: {new Date(pos.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-bold text-slate-200">{pos.amountSOL.toFixed(4)} SOL</p>
                      <p className="font-mono text-xs text-slate-500">@ ${pos.entryPriceUsd.toFixed(6)}</p>
                      {(() => {
                        const m = marks.get(pos.id);
                        if (!m || m.multiple == null) return <p className="mt-1 text-[10px] text-slate-600">Live PnL unavailable (no recent price)</p>;
                        if (m.partial) {
                          return (
                            <p className="mt-1 text-[10px] text-slate-500">
                              <span className={`font-mono font-bold ${pnlColor(m.multiple - 1)}`}>{m.multiple.toFixed(2)}×</span> · partly sold, {m.realizedSOL.toFixed(4)} SOL taken out
                            </p>
                          );
                        }
                        return (
                          <p className="mt-1 font-mono text-xs">
                            <span className={`font-bold ${pnlColor(m.multiple - 1)}`}>{m.multiple.toFixed(2)}×</span>{" "}
                            <span className={pnlColor(m.multiple - 1)}>({signed((m.multiple - 1) * 100, 1)}%)</span>{" "}
                            <span className={pnlColor(m.unrealizedSOL)}>{m.unrealizedSOL != null && signed(m.unrealizedSOL)} SOL</span>
                            <span className="ml-1 text-[9px] text-slate-600">est.</span>
                          </p>
                        );
                      })()}
                    </div>
                    {/* Sell part or all of this position (PIN-protected, same trade API as everywhere else). */}
                    <ClosePositionControl
                      tokenAddress={pos.tokenAddress}
                      symbol={pos.tokenSymbol}
                      onDone={() => { setLoading(true); fetchPositions(); }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Closed positions */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-4">
            <button
              onClick={() => setShowClosed(s => !s)}
              className="flex w-full items-center justify-between font-mono text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-slate-300"
            >
              <span>Closed Positions <span className="text-slate-600">({closedPositions.length})</span></span>
              <span>{showClosed ? "▲" : "▼"}</span>
            </button>
            {showClosed && (
              <div className="mt-4 flex flex-col gap-2">
                {closedPositions.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-600">No closed positions.</p>
                ) : closedPositions.map(pos => (
                  <div key={pos.id} className="flex items-center justify-between rounded-lg border border-slate-800/40 bg-slate-900/20 p-3 opacity-70">
                    <div>
                      <p className="font-bold text-slate-300">{pos.tokenSymbol}</p>
                      <p className="font-mono text-[10px] text-slate-500">{pos.tokenAddress.slice(0,8)}…</p>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      {(() => {
                        const m = marks.get(pos.id);
                        if (!m?.realized) {
                          return (
                            <div>
                              <p className="font-mono text-xs text-slate-400">{pos.amountSOL.toFixed(4)} SOL</p>
                              <p className="text-[10px] text-slate-600">Closed · no PnL recorded</p>
                            </div>
                          );
                        }
                        return (
                          <div>
                            <p className={`font-mono text-xs font-bold ${pnlColor(m.realized.pnlSOL)}`}>
                              {m.realized.multiple.toFixed(2)}× · {signed(m.realized.pnlPct, 1)}%
                            </p>
                            <p className={`font-mono text-[10px] ${pnlColor(m.realized.pnlSOL)}`}>{signed(m.realized.pnlSOL)} SOL</p>
                          </div>
                        );
                      })()}
                      {marks.get(pos.id)?.hasCard && (
                        <button
                          onClick={() => setCard({ id: pos.id, symbol: pos.tokenSymbol })}
                          className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition hover:bg-slate-700"
                          title="Open the closed-trade card"
                        >
                          <IconPhoto size={13} /> Card
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {card && <TradeCardModal positionId={card.id} symbol={card.symbol} onClose={() => setCard(null)} />}
    </div>
  );
}
