"use client";

import { useEffect, useRef, useState } from "react";
import { getAgentVisual } from "@/lib/hq-config";
import type { AgentData } from "./types";

interface DetailData {
  agent: AgentData;
  runsToday: number;
  recentErrors: Array<{ id: number; message: string; createdAt: string }>;
  recentActivity: Array<{ id: number; message: string; level: string; createdAt: string }>;
}

function buildReportText(d: DetailData): string {
  const lines = [
    `AGENT: ${d.agent.name.toUpperCase()}`,
    `STATUS: ${d.agent.enabled ? d.agent.status.toUpperCase() : "DISABLED"}`,
    `RUNS TODAY: ${d.runsToday}`,
    `LAST RESULT: ${d.agent.lastActionSummary ?? "no activity recorded yet"}`,
    "",
  ];
  if (d.recentErrors.length > 0) {
    lines.push(`ERRORS (${d.recentErrors.length}):`);
    for (const e of d.recentErrors) lines.push(`  - ${e.message}`);
  } else {
    lines.push("ERRORS: none recorded");
  }
  return lines.join("\n");
}

/** Reveals `text` character-by-character. A JS interval rather than a CSS steps() typewriter, since the text length is dynamic (real data), which fixed-step CSS animations can't handle. */
function useTypewriter(text: string, speedMs = 12) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    setShown("");
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(interval);
    }, speedMs);
    return () => clearInterval(interval);
  }, [text, speedMs]);
  return shown;
}

export function AgentDetailScreen({
  agentKey,
  onBack,
  registerChatHandler,
}: {
  agentKey: string;
  onBack: () => void;
  registerChatHandler: (handler: ((text: string) => Promise<void>) | null) => void;
}) {
  const [data, setData] = useState<DetailData | null>(null);
  const [chatLog, setChatLog] = useState<Array<{ from: "agent" | "you"; text: string }>>([]);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/${agentKey}/detail`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setData(d);
      });
    return () => {
      cancelled = true;
    };
  }, [agentKey]);

  // Manual trigger — pre-dates this orbit UI (dashboard "Run now" button +
  // `npm run trigger:*`) and has nothing to do with the visual redesign,
  // but the new spec's interaction model has no equivalent entry point for
  // it. Keeping it here rather than dropping a working feature silently.
  async function runNow() {
    if (running || !data?.agent.enabled) return;
    setRunning(true);
    const before = data.agent.lastActionAt;
    await fetch(`/api/agents/${agentKey}/trigger`, { method: "POST" }).catch(() => {});

    const start = Date.now();
    const poll = setInterval(async () => {
      const fresh = await fetch(`/api/agents/${agentKey}/detail`).then((r) => r.json());
      if (fresh.agent.lastActionAt !== before || Date.now() - start > 2 * 60 * 1000) {
        clearInterval(poll);
        setData(fresh);
        setRunning(false);
      }
    }, 3000);
  }

  const reportText = data ? buildReportText(data) : "";
  const typed = useTypewriter(reportText);
  const fullyRevealed = typed.length === reportText.length && reportText.length > 0;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [typed, chatLog]);

  // Command bar routes to this while the detail screen is open.
  useEffect(() => {
    registerChatHandler(async (text: string) => {
      setChatLog((log) => [...log, { from: "you", text }]);
      const res = await fetch(`/api/agents/${agentKey}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await res.json().catch(() => ({ reply: "..." }));
      setChatLog((log) => [...log, { from: "agent", text: body.reply ?? "..." }]);
    });
    return () => registerChatHandler(null);
  }, [agentKey, registerChatHandler]);

  const visual = getAgentVisual(agentKey);
  const Icon = visual.icon;

  return (
    <div className="zoom-fade-enter flex h-full w-full flex-col items-center justify-center px-4">
      <div className="flex w-full max-w-2xl flex-col rounded-xl border border-slate-800 bg-black/80 shadow-[0_0_60px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2.5">
          <Icon size={16} style={{ color: visual.color }} />
          <span className="font-mono text-xs tracking-widest text-slate-400">
            {agentKey.toUpperCase()}_DETAIL.LOG
          </span>
        </div>

        <div ref={scrollRef} className="max-h-[50vh] min-h-[220px] overflow-y-auto px-4 py-4 font-mono text-sm">
          {!data ? (
            <div className="text-emerald-500/70">loading…</div>
          ) : (
            <>
              <pre className={`whitespace-pre-wrap text-emerald-400 ${fullyRevealed ? "" : "terminal-cursor"}`}>
                {typed}
              </pre>
              {chatLog.map((entry, i) => (
                <div key={i} className={`mt-2 ${entry.from === "you" ? "text-slate-400" : "text-emerald-400"}`}>
                  <span className="text-slate-600">{entry.from === "you" ? "> " : "$ "}</span>
                  {entry.text}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="mt-5 flex gap-3">
        <button
          onClick={onBack}
          className="rounded-lg border border-slate-700 px-4 py-2 font-mono text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
        >
          ← Back to orbit
        </button>
        {data?.agent.enabled && (
          <button
            onClick={runNow}
            disabled={running}
            className="rounded-lg border border-emerald-800 px-4 py-2 font-mono text-xs text-emerald-400 transition hover:border-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Running…" : "Run now"}
          </button>
        )}
      </div>
    </div>
  );
}
