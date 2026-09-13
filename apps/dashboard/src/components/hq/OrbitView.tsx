"use client";

import { useEffect, useRef, useState } from "react";
import { getAgentVisual } from "@/lib/hq-config";
import { AgentNode } from "./AgentNode";
import { MaxCore } from "./MaxCore";
import type { AgentData } from "./types";

interface OrbitViewProps {
  agents: AgentData[];
  speaking: boolean;
  onNodeClick: (agentKey: string) => void;
  onMaxClick: () => void;
  registerNodeRef: (agentKey: string, el: HTMLDivElement | null) => void;
}

const INNER_RING_SECONDS = 28;
const OUTER_RING_SECONDS = 34;
const RECENT_ACTIVITY_MS = 24 * 60 * 60 * 1000;

/**
 * "Glowing" per spec means "currently running or has an unread finding" —
 * neither of those is a real tracked concept today (no agent run ever
 * actually flips Agent.status to "running", and there's no read/unread
 * flag anywhere), so treating every enabled agent as equally "active"
 * would just be restating the enabled filter, not the distinction the spec
 * asks for. The closest honest proxy from real data: has this agent
 * actually done something in roughly the last day, vs. sitting enabled but
 * quiet.
 */
function hasRecentActivity(agent: AgentData): boolean {
  return Boolean(agent.lastActionAt && Date.now() - new Date(agent.lastActionAt).getTime() < RECENT_ACTIVITY_MS);
}

/** angle 0 = north (up), increasing clockwise — matches the visual reference concept. */
function polarOffset(angleDeg: number, radiusPx: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: radiusPx * Math.sin(rad), y: -radiusPx * Math.cos(rad) };
}

/**
 * Measures its own rendered width (via ResizeObserver) rather than relying
 * on breakpoint classes for ring radii — a CSS percentage in `transform`
 * resolves against the *node's own* box, not the ring container's, so
 * radii have to be computed in JS from the real container size to scale
 * correctly at arbitrary viewport widths instead of just at a few
 * breakpoints.
 */
export function OrbitView({ agents, speaking, onNodeClick, onMaxClick, registerNodeRef }: OrbitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setSize(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Only enabled agents orbit — a disabled one isn't rendered at all (not
  // grayed out, not present-but-hidden), so the ring always reflects
  // exactly the live count and re-spaces itself automatically as agents
  // are enabled/disabled over time, since the angle step below is always
  // recomputed from the current array length.
  const enabledAgents = agents.filter((a) => a.enabled);
  const inner = enabledAgents.filter((a) => getAgentVisual(a.key).ring === "inner");
  const outer = enabledAgents.filter((a) => getAgentVisual(a.key).ring === "outer");

  const innerRadius = size * 0.26;
  const outerRadius = size * 0.46;

  return (
    <div
      ref={containerRef}
      className="starfield relative mx-auto aspect-square w-full max-w-[680px] overflow-hidden"
    >
      {/* Radar sweep, reaching the outer ring's radius */}
      <div
        className="radar-sweep pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: outerRadius * 2, height: outerRadius * 2 }}
      />

      {/* Inner ring */}
      <div
        className="orbit-ring-cw pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: 1, height: 1, animationDuration: `${INNER_RING_SECONDS}s` }}
      >
        {inner.map((agent, i) => {
          const { x, y } = polarOffset((360 / inner.length) * i, innerRadius);
          return (
            <div key={agent.key} className="pointer-events-auto" ref={(el) => registerNodeRef(agent.key, el)}>
              <AgentNode
                agent={agent}
                visual={getAgentVisual(agent.key)}
                xPx={x}
                yPx={y}
                ringDurationSec={INNER_RING_SECONDS}
                ringDirection="cw"
                active={hasRecentActivity(agent)}
                onClick={() => onNodeClick(agent.key)}
              />
            </div>
          );
        })}
      </div>

      {/* Outer ring — opposite direction */}
      <div
        className="orbit-ring-ccw pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: 1, height: 1, animationDuration: `${OUTER_RING_SECONDS}s` }}
      >
        {outer.map((agent, i) => {
          const { x, y } = polarOffset((360 / outer.length) * i + 12, outerRadius);
          return (
            <div key={agent.key} className="pointer-events-auto" ref={(el) => registerNodeRef(agent.key, el)}>
              <AgentNode
                agent={agent}
                visual={getAgentVisual(agent.key)}
                xPx={x}
                yPx={y}
                ringDurationSec={OUTER_RING_SECONDS}
                ringDirection="ccw"
                active={hasRecentActivity(agent)}
                onClick={() => onNodeClick(agent.key)}
              />
            </div>
          );
        })}
      </div>

      <MaxCore speaking={speaking} onClick={onMaxClick} />
    </div>
  );
}
