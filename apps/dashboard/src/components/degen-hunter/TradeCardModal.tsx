"use client";

import { useEffect, useState } from "react";
import { IconDownload, IconX } from "@tabler/icons-react";

/**
 * Shows a closed trade's card (rendered server-side as a PNG by
 * /api/agents/degen-hunter/trade-card) with a download button.
 */
export function TradeCardModal({ positionId, symbol, onClose }: { positionId: number; symbol: string; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/agents/degen-hunter/trade-card?id=${positionId}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-[640px]" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute -top-9 right-0 text-slate-400 hover:text-white">
          <IconX size={22} />
        </button>
        {failed ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center text-sm text-slate-400">
            No card available for ${symbol}. Trades closed before PnL tracking was added have no recorded exit price.
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`$${symbol} closed-trade card`} onError={() => setFailed(true)} className="w-full rounded-[22px] shadow-2xl shadow-black/60" />
        )}
        {!failed && (
          <a
            href={`${src}&download=1`}
            className="mx-auto mt-4 flex w-fit items-center gap-2 rounded-full border border-slate-600 bg-slate-800 px-5 py-2 text-sm font-medium text-slate-100 transition hover:bg-slate-700"
          >
            <IconDownload size={16} /> Download PNG
          </a>
        )}
      </div>
    </div>
  );
}
