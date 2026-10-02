"use client";

import { useState, useEffect, useCallback } from "react";
import {
  IconWallet, IconRefresh, IconAlertTriangle, IconArrowUpRight,
  IconArrowDownLeft, IconLock, IconShield, IconSend, IconQrcode,
  IconTrash, IconKey, IconClock, IconX
} from "@tabler/icons-react";

interface Position {
  id: number;
  tokenAddress: string;
  tokenSymbol: string;
  tokenAmount: number;
  amountSOL: number;
  entryPriceUsd: number;
  status: "OPEN" | "CLOSED";
  createdAt: string;
  updatedAt?: string;
}

interface WalletEvent {
  id: number;
  kind: "withdraw" | "withdraw_failed" | "trade_failed" | string;
  label: string;
  detail: string | null;
  amountSOL: number | null;
  timestamp: string;
}

interface Mark {
  tokenAddress: string;
  status: string;
  multiple: number | null;
}

type ActivityType = "buy" | "sell" | "withdraw" | "failed";
interface ActivityRow {
  key: string;
  type: ActivityType;
  title: string;
  detail: string;
  at: number;
}

// Badge colors by transaction type: green ↙ buy, amber ↗ sell, blue send, red ✕ failed.
const ACTIVITY_STYLE: Record<ActivityType, { badge: string; icon: typeof IconSend }> = {
  buy: { badge: "bg-emerald-950/70 text-emerald-400", icon: IconArrowDownLeft },
  sell: { badge: "bg-amber-950/70 text-amber-400", icon: IconArrowUpRight },
  withdraw: { badge: "bg-sky-950/70 text-sky-400", icon: IconSend },
  failed: { badge: "bg-rose-950/70 text-rose-400", icon: IconX },
};

function timeAgo(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface Activity {
  id: number;
  tokenAddress: string;
  tokenSymbol: string;
  amountSOL: number;
  entryPriceUsd: number;
  status: "OPEN" | "CLOSED";
  timestamp: string;
}

interface WalletData {
  status: "not_initialized" | "not_configured" | "unfunded" | "funded";
  address: string | null;
  balanceSol: number;
  positions: Position[];
  recentActivity: Activity[];
  balanceSource?: string;
  message?: string;
  solUsd?: number | null;
  solChange24h?: number | null;
  transactions?: WalletEvent[];
  /** Token balances the wallet actually holds on-chain, priced live. */
  tokens?: HeldToken[];
}

interface HeldToken {
  mint: string;
  symbol: string;
  name: string | null;
  amount: number;
  priceUsd: number | null;
  valueUsd: number | null;
}

function fmtTokenAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fmtUsdValue(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

type TabType = "overview" | "send" | "receive" | "settings";

export function WalletView({ initialTab = "overview" }: { initialTab?: TabType } = {}) {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notMapped, setNotMapped] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  // Send State
  const [sendDest, setSendDest] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendPin, setSendPin] = useState("");
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);

  // Settings State
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState<string | null>(null);
  const [deletePin, setDeletePin] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/degen-hunter/wallet");
      if (res.status === 401) {
        const data = await res.json();
        if (data?.error === "identity_not_mapped") {
          setNotMapped(true);
          setLoading(false);
          return;
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWallet(data);
      setNotMapped(false);
      setError(null);
      // Current multiples for the position bars; best-effort, bars just stay empty without them.
      fetch("/api/agents/degen-hunter/position-marks")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setMarks(d.marks ?? []))
        .catch(() => {});
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  const handleRefresh = () => {
    setLoading(true);
    fetchWallet();
  };

  const handleCopyAddress = () => {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSend = async () => {
    setSendError(null);
    setSendSuccess(null);
    if (!sendDest || !sendAmount || !sendPin) {
      setSendError("Please fill all fields.");
      return;
    }
    setSendLoading(true);
    try {
      const res = await fetch("/api/agents/degen-hunter/wallet/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination: sendDest, amount: sendAmount, pin: sendPin })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setSendSuccess(`Sent! TX: ${data.txid.slice(0, 8)}...`);
      setSendDest("");
      setSendAmount("");
      setSendPin("");
      handleRefresh();
    } catch (err: any) {
      setSendError(err.message);
    } finally {
      setSendLoading(false);
    }
  };

  const handleSetPin = async () => {
    setPinError(null);
    setPinSuccess(null);
    if (!newPin || newPin.length < 4) {
      setPinError("New PIN must be at least 4 digits.");
      return;
    }
    setPinLoading(true);
    try {
      const res = await fetch("/api/agents/degen-hunter/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPin, newPin })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update PIN");
      setPinSuccess("PIN updated successfully.");
      setOldPin("");
      setNewPin("");
    } catch (err: any) {
      setPinError(err.message);
    } finally {
      setPinLoading(false);
    }
  };

  const handleDeleteWallet = async () => {
    if (!confirm("Are you sure you want to delete this burner wallet? A new one will be generated. ALL FUNDS MUST BE ZERO.")) return;
    setDeleteError(null);
    if (!deletePin) {
      setDeleteError("PIN is required.");
      return;
    }
    setDeleteLoading(true);
    try {
      const res = await fetch("/api/agents/degen-hunter/wallet", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: deletePin })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete wallet");
      setDeletePin("");
      alert("Wallet deleted and a new one was generated successfully.");
      handleRefresh();
    } catch (err: any) {
      setDeleteError(err.message);
    } finally {
      setDeleteLoading(false);
    }
  };

  if (notMapped) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-amber-900/40 bg-amber-950/10 py-12 text-center">
        <IconAlertTriangle className="mb-3 text-amber-500" size={28} />
        <p className="font-mono text-sm font-medium text-amber-400">Account not connected</p>
        <p className="mt-2 max-w-sm text-xs text-amber-600/80">
          Set <code className="rounded bg-slate-800 px-1 text-slate-300">DEGEN_OWNER_CHAT_ID</code> in{" "}
          <code className="rounded bg-slate-800 px-1 text-slate-300">.env</code> to your Telegram chatId to view your wallet.
        </p>
      </div>
    );
  }

  if (error && !loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-rose-900/40 bg-rose-950/10 py-12 text-center">
        <p className="font-mono text-sm text-rose-400">{error}</p>
        <button onClick={handleRefresh} className="mt-3 rounded bg-slate-800 px-4 py-2 text-xs text-slate-200 hover:bg-slate-700">Retry</button>
      </div>
    );
  }

  if (loading && !wallet) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-32 animate-pulse rounded-xl border border-slate-800 bg-slate-900/40" />
        <div className="h-64 animate-pulse rounded-xl border border-slate-800 bg-slate-900/40" />
      </div>
    );
  }

  if (wallet?.status === "not_initialized" || wallet?.status === "not_configured" || !wallet?.address) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 border-dashed py-16 text-center">
        <IconWallet className="mb-3 text-slate-700" size={28} />
        <p className="font-mono text-sm font-medium uppercase tracking-widest text-slate-500">Burner Wallet Not Generated</p>
        <p className="mt-1 text-xs text-slate-600">
          {wallet?.message ?? "You have not created a Degen Hunter burner wallet yet."}
        </p>
        <p className="mt-4 text-xs text-slate-500">Use the Telegram bot: <code className="rounded bg-slate-800 px-1 text-slate-300">/wallet</code> → Generate Burner Wallet</p>
        <button onClick={handleRefresh} className="mt-6 rounded bg-slate-800 px-4 py-2 text-xs text-slate-200 hover:bg-slate-700">Check Again</button>
      </div>
    );
  }

  const openPositions = wallet?.positions?.filter((p) => p.status === "OPEN") ?? [];
  const markFor = (addr: string) => marks.find((m) => m.tokenAddress === addr && m.status === "OPEN");

  // Recent activity: buys (every position row), sells (closed rows), plus withdrawals and failures recorded by the send/trade routes.
  const activity: ActivityRow[] = [];
  for (const p of wallet?.positions ?? []) {
    activity.push({ key: `b${p.id}`, type: "buy", title: `Bought ${p.tokenSymbol}`, detail: `${Number(p.amountSOL).toFixed(4)} SOL`, at: Date.parse(p.createdAt) });
    if (p.status === "CLOSED" && p.updatedAt) {
      activity.push({ key: `s${p.id}`, type: "sell", title: `Sold ${p.tokenSymbol}`, detail: `${Number(p.amountSOL).toFixed(4)} SOL position`, at: Date.parse(p.updatedAt) });
    }
  }
  for (const t of wallet?.transactions ?? []) {
    const failed = t.kind !== "withdraw";
    activity.push({
      key: `t${t.id}`,
      type: failed ? "failed" : "withdraw",
      title: t.label,
      detail: [t.amountSOL != null ? `${t.amountSOL} SOL` : null, t.detail].filter(Boolean).join(" · "),
      at: Date.parse(t.timestamp),
    });
  }
  activity.sort((a, b) => b.at - a.at);
  const recent = activity.slice(0, 12);

  const usd = wallet.solUsd != null ? wallet.balanceSol * wallet.solUsd : null;

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      {/* Header & Tabs */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-slate-500">
              {wallet.address.slice(0, 8)}…{wallet.address.slice(-6)}
            </span>
            <span className="rounded border border-emerald-900/40 bg-emerald-950 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-500">
              Real Solana
            </span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-50"
          >
            <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <div className="flex gap-2 border-b border-slate-800 pb-2">
          {(["overview", "send", "receive", "settings"] as TabType[]).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`rounded px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === t ? "bg-slate-800 text-slate-200" : "text-slate-500 hover:bg-slate-900"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "overview" && (
        <div className="flex flex-col gap-5">
          {/* Hero balance card */}
          <div
            className="relative overflow-hidden rounded-[14px] border p-5"
            style={{ background: "linear-gradient(135deg, #1a2420, #0f1614)", borderColor: "#2a3a30" }}
          >
            {/* soft decorative glow, top-right */}
            <div
              className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full"
              style={{ background: "radial-gradient(circle, rgba(127,233,164,0.16) 0%, rgba(127,233,164,0) 70%)" }}
            />
            <p className="relative text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#6b8a78" }}>
              Total balance
            </p>
            <div className="relative mt-1.5 flex items-baseline gap-1.5">
              <span className="font-mono text-[30px] font-bold leading-none text-slate-100">{wallet.balanceSol.toFixed(4)}</span>
              <span className="text-base font-semibold" style={{ color: "#7fe9a4" }}>SOL</span>
            </div>
            {usd != null ? (
              <p className="relative mt-1.5 font-mono text-sm" style={{ color: "#7fe9a4" }}>
                ≈ ${usd.toFixed(2)}
                {wallet.solChange24h != null && (
                  <span className="ml-2 text-xs text-slate-500">
                    SOL {wallet.solChange24h >= 0 ? "+" : ""}{wallet.solChange24h.toFixed(1)}% today
                  </span>
                )}
              </p>
            ) : (
              <p className="relative mt-1.5 text-xs text-slate-600">USD price unavailable</p>
            )}

            <div className="relative mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => setActiveTab("send")}
                className="flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition hover:brightness-125"
                style={{ background: "#1d2c24", borderColor: "#2f4a3a", color: "#7fe9a4" }}
              >
                <IconArrowUpRight size={15} /> Send
              </button>
              <button
                onClick={() => setActiveTab("receive")}
                className="flex items-center gap-1.5 rounded-full border border-slate-700/70 bg-slate-900/50 px-4 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
              >
                <IconQrcode size={15} /> Receive
              </button>
              <button
                onClick={() => document.getElementById("wallet-activity")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="flex items-center gap-1.5 rounded-full border border-slate-700/70 bg-slate-900/50 px-4 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
              >
                <IconClock size={15} /> History
              </button>
            </div>
          </div>

          {/* Tokens held — read from the chain, priced live */}
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">Tokens · {wallet.tokens?.length ?? 0}</h3>
              {(wallet.tokens?.length ?? 0) > 0 && (
                <span className="font-mono text-xs text-[#7fe9a4]">
                  ≈ {fmtUsdValue((wallet.tokens ?? []).reduce((sum, t) => sum + (t.valueUsd ?? 0), 0))}
                </span>
              )}
            </div>
            {(wallet.tokens?.length ?? 0) === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 py-5 text-center">
                <p className="text-sm text-slate-600">No tokens in this wallet.</p>
                <p className="mt-1 text-xs text-slate-700">Tokens you buy show up here with their live value.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-3.5">
                {wallet.tokens!.map((t, i, arr) => (
                  <div key={t.mint} className={`flex items-center justify-between gap-3 py-3 ${i < arr.length - 1 ? "border-b border-slate-800/70" : ""}`}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-200">{t.symbol}</p>
                      <p className="truncate font-mono text-[11px] text-slate-500">
                        {fmtTokenAmount(t.amount)}
                        {t.priceUsd != null && <span> · @ ${t.priceUsd < 0.0001 ? t.priceUsd.toExponential(2) : t.priceUsd.toFixed(6)}</span>}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-sm font-bold text-slate-100">{t.valueUsd != null ? fmtUsdValue(t.valueUsd) : "—"}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Open positions */}
          <div>
            <h3 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Open positions · {openPositions.length}
            </h3>
            {openPositions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 py-6 text-center">
                <p className="text-sm text-slate-600">No open positions.</p>
                <p className="mt-1 text-xs text-slate-700">Use Buy on a discovered token to open a trade.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {openPositions.map((pos) => {
                  const mult = markFor(pos.tokenAddress)?.multiple ?? null;
                  const up = mult != null && mult >= 1;
                  // Decorative relative-strength bar (not an exact percentage of anything): distance from 1× scaled so ±100% fills it.
                  const fill = mult == null ? 0 : Math.min(100, Math.max(6, Math.abs(mult - 1) * 100));
                  return (
                    <div key={pos.id} className="rounded-xl border border-slate-800 bg-slate-900/40 px-3.5 py-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-200">{pos.tokenSymbol}</span>
                        <span className={`font-mono text-sm font-bold ${mult == null ? "text-slate-500" : up ? "text-emerald-400" : "text-rose-400"}`}>
                          {mult == null ? "—" : `${mult.toFixed(2)}×`}
                        </span>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full ${up ? "bg-emerald-500" : "bg-rose-500"}`}
                          style={{ width: `${fill}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div id="wallet-activity">
            <h3 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">Recent activity</h3>
            {recent.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 py-6 text-center">
                <p className="text-sm text-slate-600">No activity yet.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-3.5">
                {recent.map((row, i) => {
                  const s = ACTIVITY_STYLE[row.type];
                  const Icon = s.icon;
                  return (
                    <div key={row.key} className={`flex items-center gap-3 py-3 ${i < recent.length - 1 ? "border-b border-slate-800/70" : ""}`}>
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${s.badge}`}>
                        <Icon size={15} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-200">{row.title}</p>
                        <p className="truncate text-xs text-slate-500">
                          {[row.detail, timeAgo(row.at)].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "send" && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-6 flex flex-col gap-4">
          <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-2">
            <IconSend size={16} /> Send SOL
          </h3>
          
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Destination Address</label>
            <input 
              type="text" 
              value={sendDest} 
              onChange={e => setSendDest(e.target.value)}
              placeholder="Solana address"
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 font-mono outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Amount (SOL)</label>
            <div className="relative">
              <input 
                type="number" 
                value={sendAmount} 
                onChange={e => setSendAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 font-mono outline-none focus:border-amber-500 pr-12"
              />
              <button 
                onClick={() => setSendAmount(Math.max(0, wallet.balanceSol - 0.005).toFixed(4))}
                className="absolute right-2 top-1.5 text-[10px] font-bold text-amber-500 uppercase tracking-widest bg-amber-950/30 px-2 py-1 rounded"
              >
                Max
              </button>
            </div>
            <p className="text-[10px] text-slate-500 text-right mt-1">Available: {wallet?.balanceSol.toFixed(4)} SOL (Save ~0.005 for fees)</p>
          </div>

          <div className="flex flex-col gap-1 mt-4">
            <label className="text-xs text-amber-500 font-bold uppercase tracking-widest flex items-center gap-1">
              <IconLock size={12} /> Enter PIN to confirm
            </label>
            <input 
              type="password" 
              value={sendPin} 
              onChange={e => setSendPin(e.target.value)}
              placeholder="****"
              className="w-full rounded border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-center text-lg tracking-[0.5em] text-amber-400 font-mono outline-none focus:border-amber-500 focus:bg-amber-950/40"
            />
          </div>

          {sendError && <div className="p-3 bg-rose-950/30 border border-rose-900/50 rounded text-rose-400 text-xs">{sendError}</div>}
          {sendSuccess && <div className="p-3 bg-emerald-950/30 border border-emerald-900/50 rounded text-emerald-400 text-xs">{sendSuccess}</div>}

          <button 
            onClick={handleSend}
            disabled={sendLoading}
            className="w-full py-3 bg-slate-100 hover:bg-white text-slate-900 rounded font-bold transition-colors disabled:opacity-50 mt-2 flex items-center justify-center gap-2"
          >
            {sendLoading ? <IconRefresh className="animate-spin" size={16} /> : <IconSend size={16} />}
            {sendLoading ? "Sending..." : "Execute Send"}
          </button>
        </div>
      )}

      {activeTab === "receive" && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-6 flex flex-col items-center justify-center gap-6 text-center">
          <IconQrcode size={48} className="text-slate-500 opacity-50" />
          
          <div>
            <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
              Your Deposit Address
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mb-4">
              Send SOL to this address to fund your burner wallet. Do not send other tokens directly unless supported.
            </p>
            
            <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 flex flex-col items-center gap-3">
              <code className="text-emerald-400 font-mono text-sm sm:text-base break-all">{wallet.address}</code>
              <button
                onClick={handleCopyAddress}
                className="rounded bg-slate-800 px-4 py-2 text-xs font-bold uppercase text-slate-300 hover:bg-slate-700 transition-colors"
              >
                {copied ? "Copied!" : "Copy Address"}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "settings" && (
        <div className="flex flex-col gap-6">
          <div className="flex items-start gap-3 rounded-lg border border-emerald-900/30 bg-emerald-950/10 p-4">
            <IconShield className="text-emerald-500 shrink-0 mt-0.5" size={18} />
            <div>
              <h4 className="text-sm font-bold text-emerald-400">Security Architecture</h4>
              <p className="mt-1 text-xs text-emerald-500/80 leading-relaxed">
                This is a real Solana burner wallet, isolated from your main assets.
                Private keys are encrypted at rest. Export your private key securely via Telegram with PIN protection.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-6 flex flex-col gap-4">
            <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <IconKey size={16} /> PIN Settings
            </h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Current PIN (if set)</label>
                <input 
                  type="password" 
                  value={oldPin} 
                  onChange={e => setOldPin(e.target.value)}
                  placeholder="****"
                  className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-center text-lg tracking-[0.5em] text-slate-200 font-mono outline-none focus:border-amber-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">New PIN (4-8 digits)</label>
                <input 
                  type="password" 
                  value={newPin} 
                  onChange={e => setNewPin(e.target.value)}
                  placeholder="****"
                  className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-center text-lg tracking-[0.5em] text-slate-200 font-mono outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {pinError && <div className="p-2 bg-rose-950/30 border border-rose-900/50 rounded text-rose-400 text-xs">{pinError}</div>}
            {pinSuccess && <div className="p-2 bg-emerald-950/30 border border-emerald-900/50 rounded text-emerald-400 text-xs">{pinSuccess}</div>}

            <button 
              onClick={handleSetPin}
              disabled={pinLoading}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded font-bold uppercase tracking-widest transition-colors disabled:opacity-50 mt-2"
            >
              {pinLoading ? "Saving..." : "Set / Update PIN"}
            </button>
          </div>

          <div className="rounded-xl border border-rose-900/30 bg-rose-950/10 p-6 flex flex-col gap-4">
            <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-rose-500 flex items-center gap-2">
              <IconTrash size={16} /> Danger Zone: Delete Wallet
            </h3>
            
            <p className="text-xs text-rose-400/80">
              This will permanently delete this burner wallet and its encrypted key from the database, then generate a brand new one.
              <strong> You cannot do this if you have open positions or SOL remaining.</strong>
            </p>

            <div className="flex flex-col gap-1 mt-2">
              <label className="text-xs text-rose-500 font-bold uppercase tracking-widest">Enter PIN to Delete</label>
              <input 
                type="password" 
                value={deletePin} 
                onChange={e => setDeletePin(e.target.value)}
                placeholder="****"
                className="w-full rounded border border-rose-900/50 bg-rose-950/20 px-3 py-2 text-center text-lg tracking-[0.5em] text-rose-400 font-mono outline-none focus:border-rose-500"
              />
            </div>

            {deleteError && <div className="p-2 bg-rose-950/30 border border-rose-900/50 rounded text-rose-400 text-xs">{deleteError}</div>}

            <button 
              onClick={handleDeleteWallet}
              disabled={deleteLoading}
              className="w-full py-2 bg-rose-900/50 hover:bg-rose-900 text-rose-200 text-xs rounded font-bold uppercase tracking-widest transition-colors disabled:opacity-50 mt-2"
            >
              {deleteLoading ? "Deleting..." : "Delete and Recreate Wallet"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
