"use client";

import { useState } from "react";
import { IconSettings, IconFlame, IconAlertTriangle, IconBell, IconClock } from "@tabler/icons-react";

interface ProfileSettings {
  enabled: boolean;
  minLiquidityUsd: number;
  maxMarketCapUsd: number;
  minVolume24hUsd: number;
  maxTokenAgeMinutes: number;
  minBuySellRatio: number;
}

const DEFAULT_PROFILES: Record<string, ProfileSettings> = {
  newMeme:  { enabled: true, minLiquidityUsd: 5000,  maxMarketCapUsd: 50000,  minVolume24hUsd: 1000, maxTokenAgeMinutes: 1440,  minBuySellRatio: 0.8 },
  momentum: { enabled: true, minLiquidityUsd: 10000, maxMarketCapUsd: 200000, minVolume24hUsd: 5000, maxTokenAgeMinutes: 10080, minBuySellRatio: 1.2 },
  lowCap:   { enabled: true, minLiquidityUsd: 20000, maxMarketCapUsd: 100000, minVolume24hUsd: 2000, maxTokenAgeMinutes: 43200, minBuySellRatio: 0.9 },
  trending: { enabled: true, minLiquidityUsd: 15000, maxMarketCapUsd: 150000, minVolume24hUsd: 8000, maxTokenAgeMinutes: 20160, minBuySellRatio: 1.1 },
};

const PROFILE_NAMES: Record<string, string> = {
  newMeme: "New Meme", momentum: "Momentum", lowCap: "Low Cap", trending: "Trending",
};

function Slider({ label, value, min, max, step = 1, format, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; format: (n: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-slate-400">{label}</label>
        <span className="font-mono text-xs text-slate-300">{format(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-orange-500"
      />
    </div>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs text-slate-400">{label}</label>
      <input
        type="number" value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-28 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right font-mono text-xs text-slate-200 outline-none focus:border-orange-500"
      />
    </div>
  );
}

function Toggle({ label, value, onChange, description }: { label: string; value: boolean; onChange: (v: boolean) => void; description?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm text-slate-300">{label}</p>
        {description && <p className="text-xs text-slate-600">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${value ? "bg-orange-500" : "bg-slate-700"}`}
      >
        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${value ? "translate-x-4.5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

export function SettingsView() {
  const [profiles, setProfiles] = useState(DEFAULT_PROFILES);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [minScore, setMinScore] = useState(50);
  const [maxRisk, setMaxRisk] = useState(70);
  const [cooldownMins, setCooldownMins] = useState(30);
  const [notifyNew, setNotifyNew] = useState(true);
  const [notifyRisk, setNotifyRisk] = useState(true);
  const [notifyCritical, setNotifyCritical] = useState(true);
  const [notifyMilestone, setNotifyMilestone] = useState(true);
  const [saved, setSaved] = useState(false);

  function updateProfile(key: string, field: keyof ProfileSettings, value: number | boolean) {
    setProfiles(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  function handleSave() {
    // Settings are stored in-memory/localStorage for Phase 6. 
    // Phase 7 will persist via API to DegenHunterUser settings field.
    try {
      const settingsData = { profiles, alertsEnabled, minScore, maxRisk, cooldownMins, notifyNew, notifyRisk, notifyCritical, notifyMilestone };
      if (typeof window !== "undefined") {
        localStorage.setItem("degen_hunter_settings", JSON.stringify(settingsData));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconSettings className="text-orange-500" size={20} />
          <h2 className="text-lg font-bold text-slate-200">Settings</h2>
        </div>
        <button
          onClick={handleSave}
          className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-colors ${saved ? "bg-emerald-700 text-white" : "bg-orange-600 text-white hover:bg-orange-500"}`}
        >
          {saved ? "✓ Saved" : "Save Settings"}
        </button>
      </div>

      {/* Alerts & Notifications */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-5">
        <h3 className="mb-4 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-slate-400">
          <IconBell size={14} /> Alerts & Notifications
        </h3>
        <div className="flex flex-col gap-4">
          <Toggle label="Alerts Enabled" value={alertsEnabled} onChange={setAlertsEnabled} description="Enable or disable all alert delivery" />
          <Toggle label="New Token Alerts" value={notifyNew} onChange={setNotifyNew} description="Alert when a new token is discovered" />
          <Toggle label="Risk Change Alerts" value={notifyRisk} onChange={setNotifyRisk} description="Alert when risk level changes significantly" />
          <Toggle label="Critical Warnings" value={notifyCritical} onChange={setNotifyCritical} description="Honeypot, extreme risk, rug pull signals" />
          <Toggle label="Milestone Alerts (2×)" value={notifyMilestone} onChange={setNotifyMilestone} description="Alert when a tracked token reaches 2× from entry" />
          <div className="border-t border-slate-800 pt-4">
            <Slider
              label="Alert Cooldown (minutes)"
              value={cooldownMins} min={5} max={120} step={5}
              format={v => `${v} min`}
              onChange={setCooldownMins}
            />
          </div>
        </div>
      </div>

      {/* Scoring & Risk Thresholds */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-5">
        <h3 className="mb-4 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-slate-400">
          <IconAlertTriangle size={14} /> Score & Risk Thresholds
        </h3>
        <div className="flex flex-col gap-4">
          <Slider
            label="Minimum Alert Score"
            value={minScore} min={0} max={100}
            format={v => `${v}/100`}
            onChange={setMinScore}
          />
          <Slider
            label="Maximum Risk Tolerance"
            value={maxRisk} min={0} max={100}
            format={v => `${v}/100`}
            onChange={setMaxRisk}
          />
        </div>
      </div>

      {/* Discovery Profiles */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-5">
        <h3 className="mb-4 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-slate-400">
          <IconFlame size={14} /> Discovery Profiles
        </h3>
        <div className="flex flex-col gap-6">
          {Object.entries(profiles).map(([key, p]) => (
            <div key={key} className="rounded-lg border border-slate-800/60 bg-slate-950/30 p-4">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-bold text-slate-300">{PROFILE_NAMES[key] ?? key}</span>
                <Toggle label="" value={p.enabled} onChange={v => updateProfile(key, "enabled", v)} />
              </div>
              {p.enabled && (
                <div className="flex flex-col gap-3">
                  <NumberInput label="Min Liquidity (USD)" value={p.minLiquidityUsd} onChange={v => updateProfile(key, "minLiquidityUsd", v)} />
                  <NumberInput label="Max Market Cap (USD)" value={p.maxMarketCapUsd} onChange={v => updateProfile(key, "maxMarketCapUsd", v)} />
                  <NumberInput label="Min Volume 24h (USD)" value={p.minVolume24hUsd} onChange={v => updateProfile(key, "minVolume24hUsd", v)} />
                  <NumberInput label="Max Token Age (minutes)" value={p.maxTokenAgeMinutes} onChange={v => updateProfile(key, "maxTokenAgeMinutes", v)} />
                  <Slider
                    label="Min Buy/Sell Ratio"
                    value={p.minBuySellRatio} min={0.1} max={3} step={0.1}
                    format={v => `${v.toFixed(1)}×`}
                    onChange={v => updateProfile(key, "minBuySellRatio", v)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Scheduler */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-5">
        <h3 className="mb-4 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-slate-400">
          <IconClock size={14} /> Scheduler Intervals
        </h3>
        <div className="flex flex-col gap-1 text-xs text-slate-500 leading-relaxed">
          <p>Discovery: <span className="text-slate-400 font-mono">every 15 minutes</span></p>
          <p>Market Refresh: <span className="text-slate-400 font-mono">every 5 minutes</span></p>
          <p>Contract Risk: <span className="text-slate-400 font-mono">every 30 minutes</span></p>
          <p>Telegram Alerts: <span className="text-slate-400 font-mono">every 5 minutes</span></p>
          <p className="mt-2 text-slate-600">Scheduler interval configuration will be available in Phase 7 via environment settings.</p>
        </div>
      </div>

      {/* Security notice */}
      <div className="rounded-lg border border-slate-800/50 bg-slate-900/10 p-4 text-xs text-slate-600 leading-relaxed">
        🔒 Settings are stored locally in your browser for Phase 6. Phase 7 will persist settings server-side via the Degen Hunter user profile.
        Secrets, private keys, and API tokens are never configurable from this interface.
      </div>
    </div>
  );
}
