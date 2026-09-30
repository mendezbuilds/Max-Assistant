"use client";

import { useEffect, useState } from "react";

function formatUptime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export function TitleBar({ bootedAt, online }: { bootedAt: string | null; online: boolean }) {
  // Starts null (matches server render exactly, avoiding a hydration
  // mismatch) and is only ever set client-side inside the effect below —
  // Date.now() must never run during the render that produces the initial
  // HTML, since the server and the client hydrating it call it at two
  // different instants.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const uptimeMs = bootedAt && now !== null ? now - new Date(bootedAt).getTime() : null;

  return (
    <div className="flex items-center justify-between border-b border-jarvis-border px-4 py-1.5 sm:px-6">
      <span className="font-mono text-xs font-semibold tracking-[0.1em] text-jarvis-cyan sm:text-sm">
        MAX_OS <span className="text-jarvis-dim">//</span> MENDEZ_EMPIRE_HQ
      </span>
      <div className="flex items-center gap-3 font-mono text-xs text-jarvis-dim uppercase tracking-wider">
        {/* Only show a real elapsed-time value while genuinely online — an uptime counter next to "OFFLINE" implies the process is still running, which it isn't. */}
        {uptimeMs !== null && <span className="hidden sm:inline">UPTIME {online ? formatUptime(uptimeMs) : "—"}</span>}
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full shadow-[0_0_8px_currentColor] ${online ? "bg-jarvis-green text-jarvis-green" : "bg-slate-600 text-slate-600"}`} />
          <span className={online ? "text-jarvis-cyan" : "text-slate-500"}>{online ? "ONLINE" : "OFFLINE"}</span>
        </span>
        <form action="/api/logout" method="POST">
          <button className="text-jarvis-dim hover:text-jarvis-cyan transition-colors">LOG OUT</button>
        </form>
      </div>
    </div>
  );
}
