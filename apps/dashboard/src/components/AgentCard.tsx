"use client";

import { useState, useTransition } from "react";
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

export function AgentCard({ agent }: { agent: AgentCardData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(agent.enabled);

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
  );
}
