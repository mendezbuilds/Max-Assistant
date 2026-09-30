"use client";

import { IconPhoneOff } from "@tabler/icons-react";
import type { MaxCoreState } from "./MaxCore";

const PHASE_LABEL: Record<MaxCoreState, string> = {
  idle: "Connecting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

const PHASE_DOT_CLASS: Record<MaxCoreState, string> = {
  idle: "bg-slate-500",
  listening: "bg-jarvis-cyan",
  thinking: "bg-amber-400",
  speaking: "bg-jarvis-cyan",
};

/**
 * Replaces the normal typed CommandBar entirely while a call is active —
 * command bar text input hides/recedes, per spec, rather than sitting
 * alongside this. Mic input during a call is fully hands-off (VAD-driven,
 * see useCallMode); this bar only shows current phase and lets Mendez end
 * the call.
 */
export function CallBar({ phase, onEndCall }: { phase: MaxCoreState; onEndCall: () => void }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 px-4 py-1.5">
      <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-lg border border-jarvis-border/70 bg-slate-950/60 px-4 py-2.5 backdrop-blur-sm">
        <span className={`call-dot h-2.5 w-2.5 rounded-full ${PHASE_DOT_CLASS[phase]}`} />
        <span className="flex-1 font-mono text-sm text-slate-300">{PHASE_LABEL[phase]}</span>
        <button
          onClick={onEndCall}
          aria-label="End call"
          className="flex items-center gap-1.5 rounded-md border border-red-800/70 bg-red-950/40 px-3 py-1 font-mono text-xs text-red-400 transition hover:border-red-600"
        >
          <IconPhoneOff size={14} />
          End Call
        </button>
      </div>
    </div>
  );
}
