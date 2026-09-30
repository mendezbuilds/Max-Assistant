"use client";

import { useState } from "react";
import { IconWallet, IconArrowsRightLeft, IconLock, IconCheck, IconX, IconLoader2 } from "@tabler/icons-react";
import type { DashboardToken } from "./types";

export function TradePanel({ token, onClose }: { token: DashboardToken; onClose?: () => void }) {
  const [activeTab, setActiveTab] = useState<"buy" | "sell">("buy");
  const [amountType, setAmountType] = useState<"preset" | "custom">("preset");
  
  const [buyPreset, setBuyPreset] = useState<number>(0.1);
  const [buyCustom, setBuyCustom] = useState<string>("");
  
  const [sellPreset, setSellPreset] = useState<number>(50); // percentage
  const [sellCustom, setSellCustom] = useState<string>(""); // percentage
  
  const [slippage, setSlippage] = useState<number>(0.5); // percentage
  
  const [step, setStep] = useState<"input" | "review" | "executing" | "success" | "error">("input");
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [txid, setTxid] = useState("");

  const handleReview = () => {
    // Validate
    if (activeTab === "buy") {
      const amt = amountType === "preset" ? buyPreset : parseFloat(buyCustom);
      if (isNaN(amt) || amt <= 0) {
        setErrorMsg("Please enter a valid amount.");
        return;
      }
    } else {
      const pct = amountType === "preset" ? sellPreset : parseFloat(sellCustom);
      if (isNaN(pct) || pct <= 0 || pct > 100) {
        setErrorMsg("Please enter a valid percentage between 1 and 100.");
        return;
      }
    }
    
    setErrorMsg("");
    setStep("review");
  };

  const handleExecute = async () => {
    if (!pin || pin.length < 4) {
      setErrorMsg("Please enter a valid PIN.");
      return;
    }
    
    setStep("executing");
    setErrorMsg("");
    
    const amount = activeTab === "buy" 
      ? (amountType === "preset" ? buyPreset : parseFloat(buyCustom))
      : (amountType === "preset" ? sellPreset : parseFloat(sellCustom));
      
    try {
      const res = await fetch("/api/agents/degen-hunter/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: activeTab,
          tokenId: token.contractAddress,
          amountStr: String(amount),
          slippageBps: Math.floor(slippage * 100),
          pin
        })
      });
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || "Failed to execute trade");
      }
      
      setTxid(data.txid);
      setStep("success");
    } catch (e: any) {
      setErrorMsg(e.message || "An unknown error occurred.");
      setStep("error");
    }
  };
  
  const reset = () => {
    setStep("input");
    setPin("");
    setErrorMsg("");
    setTxid("");
  };

  if (step === "success") {
    return (
      <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-900/50 text-emerald-500 mb-4">
          <IconCheck size={24} />
        </div>
        <h3 className="text-lg font-bold text-emerald-400">Trade Executed</h3>
        <p className="mt-2 text-sm text-emerald-500/80">
          Successfully {activeTab === "buy" ? "bought" : "sold"} {token.symbol}.
        </p>
        {txid && (
          <a
            href={`https://solscan.io/tx/${txid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 block truncate rounded bg-emerald-950 px-3 py-2 text-xs font-mono text-emerald-400 hover:bg-emerald-900"
          >
            TX: {txid}
          </a>
        )}
        <button onClick={reset} className="mt-6 rounded bg-slate-800 px-4 py-2 text-xs text-slate-300 hover:bg-slate-700 w-full">
          Trade Again
        </button>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-900/50 text-rose-500 mb-4">
          <IconX size={24} />
        </div>
        <h3 className="text-lg font-bold text-rose-400">Trade Failed</h3>
        <p className="mt-2 text-sm text-rose-500/80">{errorMsg}</p>
        <button onClick={reset} className="mt-6 rounded bg-slate-800 px-4 py-2 text-xs text-slate-300 hover:bg-slate-700 w-full">
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/30 overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-slate-800">
        <button
          onClick={() => { setActiveTab("buy"); reset(); }}
          className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${
            activeTab === "buy" ? "bg-emerald-950/30 text-emerald-400 border-b-2 border-emerald-500" : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/30"
          }`}
        >
          Buy {token.symbol}
        </button>
        <button
          onClick={() => { setActiveTab("sell"); reset(); }}
          className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${
            activeTab === "sell" ? "bg-rose-950/30 text-rose-400 border-b-2 border-rose-500" : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/30"
          }`}
        >
          Sell {token.symbol}
        </button>
      </div>

      <div className="p-4">
        {step === "input" && (
          <div className="flex flex-col gap-4">
            {/* Amount Selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400">Amount</span>
                <div className="flex rounded bg-slate-950 p-0.5">
                  <button onClick={() => setAmountType("preset")} className={`px-2 py-0.5 text-[10px] rounded ${amountType === "preset" ? "bg-slate-800 text-slate-200" : "text-slate-500"}`}>Preset</button>
                  <button onClick={() => setAmountType("custom")} className={`px-2 py-0.5 text-[10px] rounded ${amountType === "custom" ? "bg-slate-800 text-slate-200" : "text-slate-500"}`}>Custom</button>
                </div>
              </div>
              
              {amountType === "preset" ? (
                <div className="grid grid-cols-4 gap-2">
                  {activeTab === "buy" 
                    ? [0.1, 0.5, 1, 5].map(amt => (
                        <button key={amt} onClick={() => setBuyPreset(amt)} className={`py-2 rounded border text-xs font-mono transition-colors ${buyPreset === amt ? "border-emerald-500/50 bg-emerald-950/30 text-emerald-400" : "border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700"}`}>
                          {amt} SOL
                        </button>
                      ))
                    : [25, 50, 75, 100].map(pct => (
                        <button key={pct} onClick={() => setSellPreset(pct)} className={`py-2 rounded border text-xs font-mono transition-colors ${sellPreset === pct ? "border-rose-500/50 bg-rose-950/30 text-rose-400" : "border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700"}`}>
                          {pct}%
                        </button>
                      ))
                  }
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="number"
                    value={activeTab === "buy" ? buyCustom : sellCustom}
                    onChange={(e) => activeTab === "buy" ? setBuyCustom(e.target.value) : setSellCustom(e.target.value)}
                    placeholder={activeTab === "buy" ? "0.00 SOL" : "0-100 %"}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-200 placeholder:text-slate-700 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-500">
                    {activeTab === "buy" ? "SOL" : "%"}
                  </span>
                </div>
              )}
            </div>

            {/* Slippage */}
            <div>
              <span className="text-xs text-slate-400 mb-2 block">Slippage (%)</span>
              <div className="flex gap-2">
                {[0.1, 0.5, 1.0].map(slip => (
                  <button key={slip} onClick={() => setSlippage(slip)} className={`flex-1 py-1.5 rounded border text-xs font-mono transition-colors ${slippage === slip ? "border-indigo-500/50 bg-indigo-950/30 text-indigo-400" : "border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700"}`}>
                    {slip}%
                  </button>
                ))}
              </div>
            </div>

            {errorMsg && <p className="text-xs text-rose-400">{errorMsg}</p>}

            <button
              onClick={handleReview}
              className={`w-full mt-2 rounded py-3 text-sm font-bold shadow-lg transition-colors ${
                activeTab === "buy" ? "bg-emerald-600 hover:bg-emerald-500 text-emerald-950 shadow-emerald-900/20" : "bg-rose-600 hover:bg-rose-500 text-rose-950 shadow-rose-900/20"
              }`}
            >
              Review {activeTab === "buy" ? "Buy" : "Sell"}
            </button>
          </div>
        )}

        {(step === "review" || step === "executing") && (
          <div className="flex flex-col gap-4">
            <div className="rounded bg-slate-950/50 p-4 border border-slate-800 border-dashed">
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3 text-center">Trade Summary</h4>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-slate-400">Action</span>
                <span className={`text-xs font-bold uppercase ${activeTab === "buy" ? "text-emerald-400" : "text-rose-400"}`}>{activeTab}</span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-slate-400">Token</span>
                <span className="text-xs font-bold text-slate-200">{token.symbol}</span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-slate-400">Amount</span>
                <span className="text-xs font-mono text-slate-200">
                  {activeTab === "buy" 
                    ? `${amountType === "preset" ? buyPreset : parseFloat(buyCustom || "0")} SOL` 
                    : `${amountType === "preset" ? sellPreset : parseFloat(sellCustom || "0")}% Position`}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">Slippage</span>
                <span className="text-xs font-mono text-slate-200">{slippage}%</span>
              </div>
            </div>

            <div className="bg-amber-950/30 border border-amber-900/40 rounded p-3 flex items-start gap-3">
              <IconLock className="text-amber-500 shrink-0 mt-0.5" size={16} />
              <div>
                <p className="text-[10px] uppercase font-bold tracking-wider text-amber-500 mb-1">Authorization Required</p>
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Enter PIN to sign"
                  disabled={step === "executing"}
                  className="w-full bg-amber-950/50 border border-amber-900/50 rounded px-3 py-1.5 text-sm text-amber-100 placeholder:text-amber-700/50 focus:outline-none focus:border-amber-500 font-mono tracking-[0.3em]"
                />
              </div>
            </div>
            
            {errorMsg && <p className="text-xs text-rose-400 text-center">{errorMsg}</p>}

            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setStep("input")}
                disabled={step === "executing"}
                className="flex-1 rounded border border-slate-700 bg-slate-800 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={handleExecute}
                disabled={step === "executing"}
                className={`flex-1 flex justify-center items-center gap-2 rounded py-2.5 text-xs font-bold shadow-lg transition-colors disabled:opacity-50 ${
                  activeTab === "buy" ? "bg-emerald-600 hover:bg-emerald-500 text-emerald-950" : "bg-rose-600 hover:bg-rose-500 text-rose-950"
                }`}
              >
                {step === "executing" ? (
                  <><IconLoader2 size={14} className="animate-spin" /> Executing...</>
                ) : (
                  <>Execute {activeTab === "buy" ? "Buy" : "Sell"}</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
