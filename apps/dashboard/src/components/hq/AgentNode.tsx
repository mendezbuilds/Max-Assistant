"use client";

import type { AgentVisual } from "@/lib/hq-config";
import type { AgentData } from "./types";

interface AgentNodeProps {
  agent: AgentData;
  visual: AgentVisual;
  xPx: number;
  yPx: number;
  ringDurationSec: number;
  ringDirection: "cw" | "ccw";
  active: boolean;
  onClick: () => void;
}

/**
 * Positioned via plain computed x/y pixel offsets from the ring's center
 * (not a static `rotate(angle)` + translateX) — an earlier version used
 * rotate() for positioning, which doesn't just move a point, it also
 * rotates everything rendered inside that element. That meant every node
 * except the one sitting at exactly 0° rendered visibly rotated by its own
 * placement angle (upside-down at 180°, sideways at 90°, etc.). Plain x/y
 * offsets sidestep the problem entirely: there's no static rotation left
 * to cancel, so the counter-rotation below only ever has to cancel the
 * ring's own continuous spin, which is what it was already doing correctly.
 */
export function AgentNode({
  agent,
  visual,
  xPx,
  yPx,
  ringDurationSec,
  ringDirection,
  active,
  onClick,
}: AgentNodeProps) {
  const Icon = visual.icon;
  const counterClass = ringDirection === "cw" ? "orbit-ring-ccw" : "orbit-ring-cw";

  return (
    <div
      className="absolute left-1/2 top-1/2"
      style={{ transform: `translate(calc(-50% + ${xPx}px), calc(-50% + ${yPx}px))` }}
    >
      <div className={counterClass} style={{ animationDuration: `${ringDurationSec}s` }}>
        <button
          onClick={onClick}
          className="group flex flex-col items-center gap-1.5 focus:outline-none"
          style={{ ["--node-glow" as string]: `${visual.color}66` }}
          aria-label={`Open ${agent.name}`}
        >
          <div className="relative flex h-12 w-12 items-center justify-center sm:h-14 sm:w-14">
            {visual.hasSaturnRing && (
              <div
                className="absolute inset-0 rounded-full border"
                style={{ borderColor: `${visual.color}55`, transform: "scaleY(0.32) rotate(-18deg)" }}
              />
            )}
            <div
              className={`relative flex h-full w-full items-center justify-center rounded-full transition-all ${
                active ? "node-active border-2" : "border opacity-70 group-hover:opacity-100"
              }`}
              style={{
                background: `radial-gradient(circle at 32% 28%, ${visual.color}ee 0%, ${visual.color}99 45%, ${visual.color}33 100%)`,
                borderColor: active ? visual.color : `${visual.color}55`,
                boxShadow: `inset 0 2px 4px rgba(255,255,255,0.35), inset 0 -3px 6px rgba(0,0,0,0.35)`,
              }}
            >
              <Icon size={20} stroke={1.75} className="text-slate-950/80" />
            </div>
          </div>
          <span
            className={`whitespace-nowrap font-mono text-[10px] tracking-wide ${
              active ? "text-slate-100" : "text-slate-500 group-hover:text-slate-300"
            }`}
          >
            {agent.name}
          </span>
        </button>
      </div>
    </div>
  );
}
