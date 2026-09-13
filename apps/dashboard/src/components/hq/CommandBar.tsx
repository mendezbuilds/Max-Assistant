"use client";

import { useState } from "react";

const NAV_WORDS = new Set(["close", "back", "exit"]);

export function CommandBar({
  mode,
  onMaxCommand,
  onAgentMessage,
  onNavigateBack,
}: {
  mode: "max" | "agent";
  onMaxCommand: (text: string) => void;
  onAgentMessage: (text: string) => void;
  onNavigateBack: () => void;
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
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur-sm">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
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
          onClick={submit}
          className="rounded-md border border-slate-700 px-3 py-1 font-mono text-xs text-slate-300 hover:border-slate-500"
        >
          Send
        </button>
      </div>
    </div>
  );
}
