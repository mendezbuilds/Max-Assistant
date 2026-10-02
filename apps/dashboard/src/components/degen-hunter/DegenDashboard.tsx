"use client";

import { useState } from "react";
import {
  IconFlame, IconEye, IconAlertTriangle, IconBriefcase,
  IconSettings, IconHistory, IconWallet, IconSearch, IconBell, IconChartBar
} from "@tabler/icons-react";

import { TokenDetailPanel } from "./TokenDetailPanel";
import { WatchlistView } from "./WatchlistView";
import { RiskView } from "./RiskView";
import { WalletView } from "./WalletView";
import { AlertsView } from "./AlertsView";
import { DiscoverView } from "./DiscoverView";
import { PositionsView } from "./PositionsView";
import { HistoryView } from "./HistoryView";
import { SettingsView } from "./SettingsView";
import { OverviewTab } from "./OverviewTab";
import { LiveAlertsStream } from "./LiveAlertsStream";
import type { LiveAlert } from "./useLiveAlerts";
import type { DashboardToken } from "./types";

type NavItem = { id: string; icon: typeof IconFlame; label: string };

// Spec order. Alerts (full alert history) and History predate this layout and
// stay reachable below Analytics rather than being dropped.
const mainNav: NavItem[] = [
  { id: "overview",  icon: IconFlame,         label: "Overview" },
  { id: "discover",  icon: IconSearch,        label: "Discover" },
  { id: "watchlist", icon: IconEye,           label: "Watchlist" },
  { id: "positions", icon: IconBriefcase,     label: "Positions" },
  { id: "risk",      icon: IconAlertTriangle, label: "Risk" },
  { id: "wallet",    icon: IconWallet,        label: "Wallet" },
  { id: "analytics", icon: IconChartBar,      label: "Analytics" },
  { id: "alerts",    icon: IconBell,          label: "Alerts" },
  { id: "history",   icon: IconHistory,       label: "History" },
];
const settingsNav: NavItem = { id: "settings", icon: IconSettings, label: "Settings" };

export function DegenDashboard({
  onBack,
  alerts,
  onDismissAlert,
}: {
  onBack: () => void;
  alerts: LiveAlert[];
  onDismissAlert: (id: string) => void;
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const [walletTab, setWalletTab] = useState<"overview" | "send">("overview");
  const [selectedToken, setSelectedToken] = useState<DashboardToken | null>(null);
  const [panelClosing, setPanelClosing] = useState(false);

  const handleOpenDetails = (token: DashboardToken) => {
    setPanelClosing(false);
    setSelectedToken(token);
  };

  const handleCloseDetails = () => {
    setPanelClosing(true);
    setTimeout(() => { setSelectedToken(null); setPanelClosing(false); }, 300);
  };

  const goTab = (id: string) => {
    if (id !== "wallet") setWalletTab("overview");
    setActiveTab(id);
  };

  const renderWorkspace = () => {
    switch (activeTab) {
      case "overview":  return <OverviewTab onOpenDetails={handleOpenDetails} onOpenWalletSend={() => { setWalletTab("send"); setActiveTab("wallet"); }} />;
      case "alerts":    return <AlertsView onOpenDetails={handleOpenDetails} />;
      case "discover":  return <DiscoverView onOpenDetails={handleOpenDetails} />;
      case "watchlist": return <WatchlistView onOpenDetails={handleOpenDetails} />;
      case "risk":      return <RiskView onOpenDetails={handleOpenDetails} />;
      case "wallet":    return <WalletView key={walletTab} initialTab={walletTab} />;
      case "positions": return <PositionsView onOpenDetails={handleOpenDetails} />;
      case "history":   return <HistoryView onOpenDetails={handleOpenDetails} />;
      case "analytics": return (
        <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-900/10">
          <IconChartBar className="mb-2 text-slate-700" size={24} />
          <p className="font-mono text-xs uppercase tracking-widest text-slate-600">Analytics</p>
          <p className="mt-1 text-[10px] text-slate-700">Not built yet</p>
        </div>
      );
      case "settings":  return <SettingsView />;
      default:          return null;
    }
  };

  const navButton = (tab: NavItem) => {
    const Icon = tab.icon;
    const isActive = activeTab === tab.id;
    return (
      <button
        key={tab.id}
        onClick={() => goTab(tab.id)}
        className={`group flex items-center gap-3 border-l-2 px-4 py-2.5 text-left transition-colors ${
          isActive
            ? "border-orange-500 bg-slate-800/70 text-slate-100"
            : "border-transparent text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
        }`}
        title={tab.label}
      >
        <Icon size={16} className={isActive ? "text-orange-500" : "group-hover:text-slate-300"} />
        <span className="hidden text-[13px] font-medium md:inline">{tab.label}</span>
      </button>
    );
  };

  return (
    <div className="zoom-fade-enter flex h-full w-full bg-slate-950 text-slate-200">

      {/* LEFT SIDEBAR — navigation */}
      <div className="flex w-14 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80 backdrop-blur-md md:w-[184px]">
        <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4">
          <IconFlame className="shrink-0 text-orange-500" size={20} />
          <div className="hidden md:block">
            <h1 className="text-[11px] font-bold uppercase leading-tight tracking-wider text-slate-100">Degen Hunter</h1>
            <div className="mt-0.5 flex items-center gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              <span className="font-mono text-[9px] uppercase tracking-widest text-emerald-400">Online</span>
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto py-2">
          <div className="flex flex-col">{mainNav.map(navButton)}</div>
          {/* gap, then Settings pinned to the bottom */}
          <div className="mt-auto pt-6">{navButton(settingsNav)}</div>
        </div>

        <div className="border-t border-slate-800 p-2">
          <button
            onClick={onBack}
            className="flex w-full items-center justify-center gap-1 rounded-lg border border-slate-700 py-1.5 font-mono text-[11px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
          >
            <span className="hidden md:inline">← Orbit</span>
            <span className="md:hidden">←</span>
          </button>
        </div>
      </div>

      {/* CENTER — workspace */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-center border-b border-slate-800 bg-slate-950/50 px-5 backdrop-blur-md">
          <h2 className="text-base font-bold text-slate-100">
            {[...mainNav, settingsNav].find((n) => n.id === activeTab)?.label ?? activeTab}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto bg-[#0a0a0c] p-4 md:p-5">{renderWorkspace()}</div>
      </div>

      {/* RIGHT — live alerts, full detail */}
      <div className="hidden w-[270px] shrink-0 flex-col border-l border-slate-800 bg-slate-950/80 backdrop-blur-md lg:flex xl:w-[320px]">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-800 px-4">
          <div className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </div>
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-300">Live Alerts</h2>
        </div>
        <LiveAlertsStream alerts={alerts} onDismiss={onDismissAlert} onOpenDetails={handleOpenDetails} variant="full" />
      </div>

      {(selectedToken || panelClosing) && (
        <TokenDetailPanel token={selectedToken} closing={panelClosing} onClose={handleCloseDetails} />
      )}
    </div>
  );
}
