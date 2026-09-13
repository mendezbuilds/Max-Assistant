"use client";

export function MaxCore({ speaking, onClick }: { speaking: boolean; onClick: () => void }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
      <button
        onClick={onClick}
        className={`max-core pointer-events-auto relative flex h-28 w-28 items-center justify-center sm:h-36 sm:w-36 ${
          speaking ? "speaking" : ""
        }`}
        style={{
          background: "radial-gradient(circle at 35% 30%, #94a3b8 0%, #64748b 45%, #334155 100%)",
        }}
        aria-label="Talk to MAX"
      >
        <span className="text-xs font-semibold tracking-widest text-slate-900/70">MAX</span>
      </button>
      <span className="mt-3 font-mono text-[11px] tracking-[0.3em] text-slate-400">MAX</span>
    </div>
  );
}
