"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  IconWallet, IconRefresh, IconAlertTriangle, IconArrowUpRight, 
  IconArrowDownLeft, IconLock, IconShield, IconSend, IconQrcode, 
  IconSettings, IconTrash, IconKey
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
}

type TabType = "overview" | "send" | "receive" | "settings";

export function WalletView() {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notMapped, setNotMapped] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("overview");

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

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* Header & Tabs */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 border border-slate-800 text-slate-400">
              <IconWallet size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-200">Burner Wallet</h2>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-500">
                  {wallet.address.slice(0, 8)}…{wallet.address.slice(-6)}
                </span>
                <span className="rounded bg-emerald-950 border border-emerald-900/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-500">
                  Real Solana
                </span>
              </div>
            </div>
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
          <button onClick={() => setActiveTab("overview")} className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-colors ${activeTab === 'overview' ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:bg-slate-900'}`}>Overview</button>
          <button onClick={() => setActiveTab("send")} className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-colors ${activeTab === 'send' ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:bg-slate-900'}`}>Send</button>
          <button onClick={() => setActiveTab("receive")} className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-colors ${activeTab === 'receive' ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:bg-slate-900'}`}>Receive</button>
          <button onClick={() => setActiveTab("settings")} className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-colors ${activeTab === 'settings' ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:bg-slate-900'}`}>Settings</button>
        </div>
      </div>

      {activeTab === "overview" && (
        <div className="flex flex-col gap-6">
          {/* Balance Card */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden relative">
            <div className="absolute top-4 right-4">
              {wallet?.status === "unfunded" ? (
                <span className="rounded-full bg-amber-950/50 border border-amber-900/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-500">Unfunded</span>
              ) : (
                <span className="rounded-full bg-emerald-950/50 border border-emerald-900/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-500">Funded</span>
              )}
            </div>
            <div className="p-6">
              <p className="font-mono text-xs font-bold uppercase tracking-widest text-slate-500">Real SOL Balance</p>
              <div className="mt-2 flex items-end gap-2">
                <span className="font-mono text-4xl font-bold text-slate-100">{wallet?.balanceSol.toFixed(4)}</span>
                <span className="mb-1 font-mono text-lg text-slate-500">SOL</span>
              </div>
            </div>
          </div>

          {/* Open Positions */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-4">
            <h3 className="mb-4 font-mono text-xs font-bold uppercase tracking-widest text-slate-400">Open Positions ({openPositions.length})</h3>
            {openPositions.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-600">No open positions.</p>
                <p className="mt-1 text-xs text-slate-700">Use the Buy button in Telegram to open a trade.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {openPositions.map((pos) => (
                  <div key={pos.id} className="flex items-center justify-between rounded-lg border border-slate-800/60 bg-slate-900/40 p-3">
                    <div>
                      <p className="font-bold text-slate-200">{pos.tokenSymbol}</p>
                      <p className="font-mono text-[10px] text-slate-500">{pos.tokenAddress.slice(0, 8)}…{pos.tokenAddress.slice(-6)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm text-slate-300">{pos.amountSOL.toFixed(4)} SOL</p>
                      <p className="font-mono text-xs text-slate-500">Entry: ${pos.entryPriceUsd.toFixed(6)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Activity */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-4">
            <h3 className="mb-4 font-mono text-xs font-bold uppercase tracking-widest text-slate-400">Position History</h3>
            {wallet?.recentActivity?.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-600">No history yet.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-0">
                {wallet?.recentActivity?.map((act) => (
                  <div key={act.id} className="flex items-center justify-between border-b border-slate-800/60 py-3 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${act.status === 'OPEN' ? 'bg-emerald-950/50 text-emerald-500' : 'bg-rose-950/50 text-rose-500'}`}>
                        {act.status === 'OPEN' ? <IconArrowDownLeft size={14} /> : <IconArrowUpRight size={14} />}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-300">
                          {act.status === 'OPEN' ? 'Bought' : 'Sold'} {act.tokenSymbol}
                        </p>
                        <p className="font-mono text-xs text-slate-500">{new Date(act.timestamp).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-bold text-slate-200">
                        {act.amountSOL.toFixed(4)} SOL
                      </p>
                      <p className="font-mono text-[10px] text-slate-500">@ ${act.entryPriceUsd.toExponential(2)}</p>
                    </div>
                  </div>
                ))}
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
