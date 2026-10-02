"use client";

import { useState } from "react";
import { IconCheck, IconLoader2, IconLock } from "@tabler/icons-react";

/**
 * Sell (partly or fully) one open position, right from the Positions tab.
 * Posts to the same /api/agents/degen-hunter/trade route as the token panel, so
 * it gets the same protections: PIN with brute-force lockout, the per-trade
 * spend cap, a wait for on-chain confirmation, and realized-PnL recording.
 * A sell of 100% closes the position (and produces its trade card).
 */
export function ClosePositionControl({
  tokenAddress,
  symbol,
  onDone,
}: {
  tokenAddress: string;
  symbol: string;
  /** Called after a sell succeeds, so the lists can refresh. */
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState<25 | 50 | 100>(100);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [txid, setTxid] = useState("");

  const sell = async () => {
    if (pin.length < 4) {
      setError("Enter your PIN.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/agents/degen-hunter/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sell", tokenId: tokenAddress, amountStr: String(percent), pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || "The sell failed.");
      setTxid(data.txid ?? "");
      setPin("");
      onDone();
    } catch (e: any) {
      setError(e?.message ?? "The sell failed.");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  if (txid) {
    return (
      <div className="flex w-full basis-full items-center justify-between gap-2 rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-400">
        <span className="flex items-center gap-1.5">
          <IconCheck size={14} /> Sold {percent}% of {symbol}
        </span>
        <a href={`https://solscan.io/tx/${txid}`} target="_blank" rel="noopener noreferrer" className="font-mono underline hover:text-emerald-300">
          view tx
        </a>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="flex w-full basis-full justify-end">
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-950/60"
        >
          Sell / Close
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full basis-full flex-col gap-2.5 rounded-lg border border-slate-700 bg-slate-950/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300">Sell {symbol}</span>
        <div className="flex gap-1.5">
          {([25, 50, 100] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPercent(p)}
              disabled={busy}
              className={`rounded-md px-2.5 py-1 font-mono text-xs transition ${
                percent === p ? "bg-rose-600 font-bold text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {p === 100 ? "All" : `${p}%`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <IconLock size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-amber-600" />
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            onKeyDown={(e) => e.key === "Enter" && !busy && sell()}
            placeholder="PIN"
            disabled={busy}
            className="w-full rounded-md border border-amber-900/50 bg-amber-950/20 py-1.5 pl-8 pr-2 font-mono text-sm tracking-[0.3em] text-amber-300 outline-none focus:border-amber-500"
          />
        </div>
        <button
          onClick={sell}
          disabled={busy || pin.length < 4}
          className="flex items-center gap-1.5 rounded-md bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <><IconLoader2 size={13} className="animate-spin" /> Confirming…</> : percent === 100 ? "Close position" : `Sell ${percent}%`}
        </button>
        <button onClick={() => { setOpen(false); setError(""); setPin(""); }} disabled={busy} className="text-xs text-slate-500 hover:text-slate-300">
          Cancel
        </button>
      </div>

      {busy && <p className="text-[11px] text-slate-500">Sending the swap and waiting for the chain to confirm it — this can take 10–30 seconds.</p>}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
