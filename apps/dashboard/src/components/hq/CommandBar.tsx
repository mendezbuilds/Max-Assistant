"use client";

import { useState } from "react";
import { IconPhone } from "@tabler/icons-react";

const NAV_WORDS = new Set(["close", "back", "exit"]);

/**
 * Typed command input. Voice input is now handled entirely by call mode
 * (see useCallMode.ts / CallBar.tsx) — this replaces the earlier
 * push-to-talk mic button, which is gone, not kept alongside this. The
 * phone icon here only starts a call; once a call is active, this whole
 * component is swapped out for CallBar by the parent.
 */
export function CommandBar({
  mode,
  onMaxCommand,
  onAgentMessage,
  onNavigateBack,
  onStartCall,
  callError,
}: {
  mode: "max" | "agent";
  onMaxCommand: (text: string) => void;
  onAgentMessage: (text: string) => void;
  onNavigateBack: () => void;
  onStartCall: () => void;
  callError: string | null;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const text = value.trim();
    if (!text) return;
    setValue("");

    if (mode === "agent" && NAV_WORDS.has(text.toLowerCase())) {
      onNavigateBack();
      return;
    }

    if (mode === "agent") {
      onAgentMessage(text);
    } else {
      onMaxCommand(text);
    }
  }

  return (
    // No background/border strip of its own — sits directly on the same
    // starfield plane as the rest of the page instead of reading as a
    // separate dark bar docked at the bottom. Only the input field itself
    // gets an outline, matching the reference.
    <div className="fixed bottom-0 left-0 right-0 z-30 px-4 py-1.5">
      {callError && (
        <div className="mx-auto mb-2 max-w-3xl rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-1.5 font-mono text-xs text-red-400">
          {callError}
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-lg border border-slate-800/70 bg-slate-950/40 px-3 py-2 backdrop-blur-sm">
        <span className="font-mono text-xs text-slate-600">{mode === "agent" ? ">" : "MAX >"}</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={mode === "agent" ? "Talk to this agent… (or type 'back')" : "Talk to MAX…"}
          className="flex-1 bg-transparent font-mono text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none"
        />
        <button
          onClick={onStartCall}
          aria-label="Start a call with MAX"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 text-slate-400 transition hover:border-jarvis-cyan hover:text-jarvis-cyan"
        >
          <IconPhone size={14} />
        </button>
        <button
          onClick={submit}
          className="rounded-md border border-slate-700 px-3 py-1 font-mono text-xs text-slate-300 hover:border-slate-500"
        >
          Send
        </button>
      </div>
    </div>
  );
}
