"use client";

import { IconBrain } from "@tabler/icons-react";

export type MaxCoreState = "idle" | "listening" | "thinking" | "speaking";

export function MaxCore({ state, onClick, size }: { state: MaxCoreState; onClick: () => void; size: number }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
      <button
        onClick={onClick}
        // Sized from the orbit's own measured size (passed in), not a
        // fixed CSS breakpoint — a fixed size stopped scaling with the
        // orbit once the orbit itself was widened, making MAX and the
        // nodes look disproportionately small next to the now-much-bigger
        // rings.
        className={`max-core pointer-events-auto relative flex items-center justify-center ${
          state === "speaking" ? "speaking" : state === "listening" ? "listening" : ""
        }`}
        style={{
          width: size,
          height: size,
          // Muted blue-gray, dimmer than the agent nodes, not brighter — confirmed exact values from design review.
          background: "radial-gradient(circle at 35% 30%, #4a7a80, #1a2a2c 75%)",
        }}
        aria-label="Talk to MAX"
      >
        <IconBrain size={Math.round(size * 0.34)} stroke={1.5} className="text-white/90" />
      </button>
      <div className="mt-3 flex items-center gap-2">
        <span className="font-mono text-[11px] tracking-[0.3em] text-slate-400">
          {state === "thinking" ? "THINKING" : state === "listening" ? "LISTENING" : "MAX"}
        </span>
        {state === "thinking" && (
          <span className="flex gap-0.5">
            <span className="thinking-dot h-1 w-1 rounded-full bg-jarvis-cyan" style={{ animationDelay: "0ms" }} />
            <span className="thinking-dot h-1 w-1 rounded-full bg-jarvis-cyan" style={{ animationDelay: "150ms" }} />
            <span className="thinking-dot h-1 w-1 rounded-full bg-jarvis-cyan" style={{ animationDelay: "300ms" }} />
          </span>
        )}
      </div>
    </div>
  );
}
