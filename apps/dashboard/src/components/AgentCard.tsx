"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface AgentCardData {
  key: string;
  name: string;
  icon: string;
  description: string;
  phase: number;
  enabled: boolean;
  status: string;
  lastActionAt: string | null;
  lastActionSummary: string | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const statusColor: Record<string, string> = {
  idle: "bg-neutral-700 text-neutral-200",
  running: "bg-emerald-900 text-emerald-300",
  error: "bg-red-900 text-red-300",
  disabled: "bg-neutral-800 text-neutral-500",
};

// How long to keep polling for a manually-triggered run to finish before
// giving up and re-enabling the button anyway. Core polls for the trigger
// itself every ~10s (see apps/core/src/scheduler.ts) on top of however long
// the run itself takes, so this needs real headroom.
const RUN_POLL_INTERVAL_MS = 3000;
const RUN_POLL_TIMEOUT_MS = 2 * 60 * 1000;

export function AgentCard({ agent }: { agent: AgentCardData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(agent.enabled);
  const [running, setRunning] = useState(false);
  const pollRef = useRef<{ interval: ReturnType<typeof setInterval>; timeout: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => {
    // Clear any in-flight poll if the card unmounts mid-run.
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current.interval);
        clearTimeout(pollRef.current.timeout);
      }
    };
  }, []);

  async function toggle() {
    const next = !enabled;
    setEnabled(next); // optimistic
    const res = await fetch(`/api/agents/${agent.key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    if (!res.ok) {
      setEnabled(!next); // revert on failure
      return;
    }
    startTransition(() => router.refresh());
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current.interval);
      clearTimeout(pollRef.current.timeout);
      pollRef.current = null;
    }
    setRunning(false);
  }

  async function runNow() {
    if (running) return;

    const res = await fetch(`/api/agents/${agent.key}/trigger`, { method: "POST" });
    if (!res.ok) return; // e.g. disabled — button shouldn't be clickable in that state anyway

    setRunning(true);
    const sinceIso = agent.lastActionAt;

    const interval = setInterval(async () => {
      const check = await fetch(`/api/agents/${agent.key}`).then((r) => (r.ok ? r.json() : null));
      const finished = check?.lastActionAt && check.lastActionAt !== sinceIso;
      if (finished) {
        stopPolling();
        startTransition(() => router.refresh());
      }
    }, RUN_POLL_INTERVAL_MS);

    const timeout = setTimeout(() => {
      // Gave up waiting — don't leave the button stuck disabled forever.
      // The activity feed will still show the result whenever it lands.
      stopPolling();
      startTransition(() => router.refresh());
    }, RUN_POLL_TIMEOUT_MS);

    pollRef.current = { interval, timeout };
  }

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-sm">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl leading-none">{agent.icon}</span>
            <span className="font-medium text-neutral-50">{agent.name}</span>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              statusColor[agent.status] ?? statusColor.idle
            }`}
          >
            {agent.status}
          </span>
        </div>
        <p className="mt-2 text-sm text-neutral-400">{agent.description}</p>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-neutral-800 pt-3">
        <div className="text-xs text-neutral-500">
          <div>Phase {agent.phase}</div>
          <div>Last action: {timeAgo(agent.lastActionAt)}</div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={runNow}
            disabled={!enabled || running}
            title={enabled ? "Run this agent now" : "Enable the agent to run it"}
            className="rounded-lg border border-neutral-700 px-2 py-1 text-xs font-medium text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-neutral-700 disabled:hover:text-neutral-300"
          >
            {running ? "Running…" : "Run now"}
          </button>
          <button
            onClick={toggle}
            disabled={isPending}
            aria-pressed={enabled}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              enabled ? "bg-emerald-600" : "bg-neutral-700"
            } disabled:opacity-50`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
