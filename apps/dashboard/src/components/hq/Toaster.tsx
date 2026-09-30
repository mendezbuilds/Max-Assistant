"use client";

import { useEffect, useState, useRef } from "react";
import { IconX, IconBell, IconArrowRight, IconFlame } from "@tabler/icons-react";

interface Alert {
  id: number;
  agentKey: string;
  level: string;
  message: string;
  meta: any;
}

export function Toaster({ onZoomAgent }: { onZoomAgent: (key: string) => void }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const lastCheckedId = useRef<number | null>(null);

  // Keep track of timeouts so we don't set multiple timeouts for the same alert
  const activeTimeouts = useRef<Set<number>>(new Set());

  // Poll for new alerts
  useEffect(() => {
    // Initial fetch just to get the max ID so we don't spam old alerts on refresh
    const initializeId = async () => {
      try {
        // Fetch the single most recent alert just to set the cursor
        const res = await fetch("/api/alerts?limit=1");
        if (res.ok) {
          const data = await res.json();
          if (data.length > 0) {
            lastCheckedId.current = data[data.length - 1].id;
          } else {
            lastCheckedId.current = 0;
          }
        }
      } catch (e) {
        console.error("Failed to initialize toaster ID", e);
        lastCheckedId.current = 0;
      }
    };

    initializeId();

    const interval = setInterval(async () => {
      if (lastCheckedId.current === null) return;
      
      try {
        const res = await fetch(`/api/alerts?afterId=${lastCheckedId.current}`);
        if (res.ok) {
          const newAlerts: any[] = await res.json();
          if (newAlerts.length > 0) {
            // Update cursor
            lastCheckedId.current = newAlerts[newAlerts.length - 1].id;
            
            // Parse meta and append to queue
            const parsedAlerts = newAlerts.map(a => ({
              ...a,
              meta: a.meta ? JSON.parse(a.meta) : {}
            }));
            
            setAlerts(prev => [...prev, ...parsedAlerts]);
          }
        }
      } catch (e) {
        console.error("Failed to fetch alerts", e);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Auto-dismiss logic - individual timers for each alert
  useEffect(() => {
    alerts.forEach(alert => {
      if (!activeTimeouts.current.has(alert.id)) {
        activeTimeouts.current.add(alert.id);
        setTimeout(() => {
          setAlerts(prev => prev.filter(a => a.id !== alert.id));
          activeTimeouts.current.delete(alert.id);
        }, 6000);
      }
    });
  }, [alerts]);

  const dismissAlert = (id: number) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const handleView = (alert: Alert) => {
    dismissAlert(alert.id);
    onZoomAgent(alert.agentKey);
  };

  if (alerts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed left-0 right-0 top-16 z-50 flex flex-col items-center gap-3">
      {alerts.map((alert) => {
        const isDegen = alert.agentKey === "degen-hunter";
        const Icon = isDegen ? IconFlame : IconBell;
        const colorClass = isDegen ? "text-orange-500" : "text-slate-200";
        const borderClass = isDegen ? "border-orange-500/30" : "border-slate-700";

        return (
          <div 
            key={alert.id}
            className={`pointer-events-auto flex w-full max-w-md items-center justify-between gap-4 rounded-xl border bg-slate-950/95 p-3 shadow-2xl shadow-black/50 backdrop-blur-md transition-all animate-in slide-in-from-top-4 fade-in duration-300 ${borderClass}`}
          >
            <div className="flex flex-1 items-center gap-3 overflow-hidden">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 ${colorClass}`}>
                <Icon size={20} />
              </div>
              <div className="flex flex-col truncate">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {alert.agentKey.replace("-", " ")}
                  </span>
                  {alert.meta?.type === "2x-milestone" && (
                    <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-400">
                      2× Milestone
                    </span>
                  )}
                </div>
                <p className="truncate text-sm font-medium text-slate-200">{alert.message}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button 
                onClick={() => handleView(alert)}
                className="flex items-center gap-1 rounded bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700"
              >
                VIEW <IconArrowRight size={14} />
              </button>
              <button 
                onClick={() => dismissAlert(alert.id)}
                className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              >
                <IconX size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
