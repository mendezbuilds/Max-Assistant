"use client";

import { useCallback, useEffect, useState } from "react";
import {
  IconFlame, IconEye, IconAlertTriangle, IconBriefcase,
  IconSettings, IconRefresh, IconHistory, IconWallet, IconSearch, IconBell, IconChartBar
} from "@tabler/icons-react";

import { TokenFeed } from "./TokenFeed";
import { TokenDetailPanel } from "./TokenDetailPanel";
import { WatchlistView } from "./WatchlistView";
import { RiskView } from "./RiskView";
import { WalletView } from "./WalletView";
import { AlertsView } from "./AlertsView";
import { DiscoverView } from "./DiscoverView";
import { PositionsView } from "./PositionsView";
import { HistoryView } from "./HistoryView";
import { SettingsView } from "./SettingsView";
import { LiveAlertsStream } from "./LiveAlertsStream";
import { useWatchlist } from "./useWatchlist";
import type { DashboardToken } from "./types";

interface OverviewStats {
  tokenCount: number;
  walletBalance: number | null;
  walletStatus: string | null;
  openPositions: number;
}

const navItems = [
  { id: "overview",   icon: IconFlame,         label: "Overview" },
  { id: "alerts",     icon: IconBell,          label: "Alerts" },
  { id: "discover",   icon: IconSearch,        label: "Discover" },
  { id: "watchlist",  icon: IconEye,           label: "Watchlist" },
  { id: "risk",       icon: IconAlertTriangle, label: "Risk" },
  { id: "wallet",     icon: IconWallet,        label: "Wallet" },
  { id: "positions",  icon: IconBriefcase,     label: "Positions" },
  { id: "history",    icon: IconHistory,       label: "History" },
  { id: "settings",   icon: IconSettings,      label: "Settings" },
];

export function DegenDashboard({ onBack }: { onBack: () => void }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedToken, setSelectedToken] = useState<DashboardToken | null>(null);
  const [panelClosing, setPanelClosing] = useState(false);
  const [stats, setStats] = useState<OverviewStats>({
    tokenCount: 0, walletBalance: null, walletStatus: null, openPositions: 0,
  });
  const { count: watchlistCount, notMapped: watchlistNotMapped } = useWatchlist();

  const fetchStats = useCallback(async () => {
    try {
      const [feedRes, walletRes] = await Promise.allSettled([
        fetch("/api/agents/degen-hunter/feed?limit=1"),
        fetch("/api/agents/degen-hunter/wallet"),
      ]);
      if (feedRes.status === "fulfilled" && feedRes.value.ok) {
        const d = await feedRes.value.json();
        setStats(prev => ({ ...prev, tokenCount: d.count ?? prev.tokenCount }));
      }
      if (walletRes.status === "fulfilled" && walletRes.value.ok) {
        const d = await walletRes.value.json();
        setStats(prev => ({
          ...prev,
          walletBalance: d.balanceSol ?? null,
          walletStatus: d.status ?? null,
          openPositions: (d.tokenBalances ?? []).length,
        }));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchStats();
    const t = setInterval(fetchStats, 30_000);
    return () => clearInterval(t);
  }, [fetchStats]);

  const handleOpenDetails = (token: DashboardToken) => {
    setPanelClosing(false);
    setSelectedToken(token);
  };

  const handleCloseDetails = () => {
    setPanelClosing(true);
    setTimeout(() => { setSelectedToken(null); setPanelClosing(false); }, 300);
  };

  const renderWorkspace = () => {
    switch (activeTab) {
      case "overview":  return <OverviewTab stats={stats} watchlistCount={watchlistCount} watchlistNotMapped={watchlistNotMapped} onOpenDetails={handleOpenDetails} />;
      case "alerts":    return <AlertsView onOpenDetails={handleOpenDetails} />;
      case "discover":  return <DiscoverView onOpenDetails={handleOpenDetails} />;
      case "watchlist": return <WatchlistView onOpenDetails={handleOpenDetails} />;
      case "risk":      return <RiskView onOpenDetails={handleOpenDetails} />;
      case "wallet":    return <WalletView />;
      case "positions": return <PositionsView onOpenDetails={handleOpenDetails} />;
      case "history":   return <HistoryView onOpenDetails={handleOpenDetails} />;
      case "settings":  return <SettingsView />;
      default:          return null;
    }
  };

  return (
    <div className="zoom-fade-enter flex h-full w-full bg-slate-950 text-slate-200">

      {/* LEFT SIDEBAR */}
      <div className="flex w-16 flex-col border-r border-slate-800 bg-slate-950/80 backdrop-blur-md md:w-56 shrink-0">
        {/* Identity */}
        <div className="flex items-center gap-3 border-b border-slate-800 p-4">
          <IconFlame className="text-orange-500 shrink-0" size={24} />
          <div className="hidden md:block">
            <h1 className="text-sm font-bold tracking-wider text-slate-100 uppercase">Degen Hunter</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              <span className="text-[10px] uppercase text-emerald-400 font-mono tracking-widest">Online</span>
            </div>
          </div>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-4">
          <div className="flex flex-col gap-0.5 px-2">
            {navItems.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                    isActive ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                  }`}
                  title={tab.label}
                >
                  <Icon size={18} className={isActive ? "text-orange-500" : "group-hover:text-slate-300"} />
                  <span className="hidden text-sm font-medium md:inline">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Back button */}
        <div className="border-t border-slate-800 p-4">
          <button
            onClick={onBack}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 py-2 text-xs font-mono text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
          >
            <span className="hidden md:inline">← Back to Orbit</span>
            <span className="md:hidden">←</span>
          </button>
        </div>
      </div>

      {/* CENTER WORKSPACE */}
      <div className="flex flex-1 flex-col overflow-hidden relative min-w-0">
        {/* Workspace Header */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950/50 px-6 backdrop-blur-md">
          <h2 className="text-lg font-bold capitalize text-slate-100">
            {navItems.find(n => n.id === activeTab)?.label ?? activeTab}
          </h2>
          <button
            onClick={fetchStats}
            className="flex items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
          >
            <IconRefresh size={14} /> Refresh
          </button>
        </div>

        {/* Workspace Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#0a0a0c]">
          {renderWorkspace()}
        </div>
      </div>

      {/* RIGHT SIDEBAR: Live Alerts */}
      <div className="hidden w-64 flex-col border-l border-slate-800 bg-slate-950/80 backdrop-blur-md lg:flex shrink-0">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-800 px-4">
          <div className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </div>
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-slate-300">Live Alerts</h2>
        </div>
        <LiveAlertsStream onOpenDetails={handleOpenDetails} />
      </div>

      {/* Token Detail Panel */}
      {(selectedToken || panelClosing) && (
        <TokenDetailPanel token={selectedToken} closing={panelClosing} onClose={handleCloseDetails} />
      )}
    </div>
  );
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab({
  stats,
  watchlistCount,
  watchlistNotMapped,
  onOpenDetails,
}: {
  stats: OverviewStats;
  watchlistCount: number;
  watchlistNotMapped: boolean;
  onOpenDetails: (token: DashboardToken) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Tokens Found" value={stats.tokenCount.toLocaleString()} />
        <StatCard
          label="Watchlist"
          value={watchlistNotMapped ? "—" : watchlistCount.toString()}
          sub={watchlistNotMapped ? "Account not connected" : undefined}
        />
        <StatCard
          label="Burner Wallet"
          value={stats.walletBalance != null ? `${stats.walletBalance.toFixed(4)} SOL` : "—"}
          sub={stats.walletStatus === "not_configured" ? "Not configured" : stats.walletStatus === "unfunded" ? "Unfunded" : undefined}
          mono
        />
        <StatCard
          label="Open Positions"
          value={stats.openPositions.toString()}
        />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left col */}
        <div className="flex flex-col gap-4 lg:col-span-1">
          <div className="rounded-lg border border-slate-800 bg-slate-900/20 p-4">
            <h3 className="mb-3 font-mono text-xs font-bold uppercase tracking-widest text-slate-400">Quick Status</h3>
            <div className="flex flex-col gap-2 text-xs">
              <StatusRow label="Agent" value="Online" good />
              <StatusRow label="Data Source" value="DexScreener" good />
              <StatusRow label="Discovery" value="Active" good />
              <StatusRow label="Telegram Bot" value="Running" good />
              <StatusRow label="Chain" value="Solana" good />
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/20 p-4">
            <h3 className="mb-3 font-mono text-xs font-bold uppercase tracking-widest text-slate-400">Paper Wallet</h3>
            <div className="flex items-end gap-1">
              <span className="font-mono text-2xl font-bold text-slate-100">
                {stats.walletBalance != null ? stats.walletBalance.toFixed(4) : "—"}
              </span>
              {stats.walletBalance != null && <span className="mb-0.5 text-sm text-slate-500">SOL</span>}
            </div>
            {stats.walletStatus === "not_configured" && (
              <p className="mt-1 text-[10px] text-amber-600">Wallet not configured. Use /wallet in Telegram.</p>
            )}
          </div>
        </div>

        {/* Right col */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <div className="flex h-36 flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-900/10">
            <IconChartBar className="mb-2 text-slate-700" size={24} />
            <p className="font-mono text-xs uppercase tracking-widest text-slate-600">Chart / Analytics</p>
            <p className="mt-1 text-[10px] text-slate-700">Coming in Phase 7</p>
          </div>
          <TokenFeed onOpenDetails={onOpenDetails} />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, mono }: { label: string; value: string; sub?: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-xs text-slate-500 uppercase tracking-widest font-mono">{label}</div>
      <div className={`mt-2 text-2xl font-bold text-slate-100 ${mono ? "font-mono" : ""}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-600 mt-1">{sub}</div>}
    </div>
  );
}

function StatusRow({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <div className="flex items-center gap-1.5">
        <div className={`h-1.5 w-1.5 rounded-full ${good ? "bg-emerald-500" : "bg-slate-600"}`} />
        <span className={good ? "text-emerald-400" : "text-slate-500"}>{value}</span>
      </div>
    </div>
  );
}
