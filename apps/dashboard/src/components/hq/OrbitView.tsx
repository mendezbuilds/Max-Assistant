"use client";

import { useEffect, useRef, useState } from "react";
import { getAgentVisual } from "@/lib/hq-config";
import { ORBIT_BANK_DEG, ORBIT_TILT_Y_SCALE } from "@/lib/orbit-tilt";
import { AgentNode } from "./AgentNode";
import { MaxCore } from "./MaxCore";
import type { MaxCoreState } from "./MaxCore";
import type { AgentData } from "./types";

interface OrbitViewProps {
  agents: AgentData[];
  maxState: MaxCoreState;
  onNodeClick: (agentKey: string) => void;
  onMaxClick: () => void;
  registerNodeRef: (agentKey: string, el: HTMLElement | null) => void;
}

// Bands (as a fraction of the container's size) each ring's agents spread
// across — every agent gets its own distinct radius within its band rather
// than all sharing one exact radius, so the orbit reads as a real scattered
// system of individual paths instead of two neat circles.
// Inner band starts well clear of MAX's own core (fixed ~144px/36 tailwind
// units regardless of container size) rather than right up against it —
// 0.16 left barely any breathing room once the orbit was expanded.
const INNER_BAND: [number, number] = [0.22, 0.34];
const OUTER_BAND: [number, number] = [0.44, 0.5];
const INNER_DURATION_BASE = 28;
const OUTER_DURATION_BASE = 34;
const RECENT_ACTIVITY_MS = 24 * 60 * 60 * 1000;

function hasRecentActivity(agent: AgentData): boolean {
  return Boolean(agent.lastActionAt && Date.now() - new Date(agent.lastActionAt).getTime() < RECENT_ACTIVITY_MS);
}

/** Spreads `count` items evenly across [min, max]; a single item lands at the midpoint rather than at `min`. */
function spread(index: number, count: number, [min, max]: [number, number]): number {
  if (count <= 1) return (min + max) / 2;
  return min + (index / (count - 1)) * (max - min);
}

/**
 * A full ellipse as an SVG path string, in the orbit container's own
 * absolute-pixel coordinate space — two arcs, since a single SVG arc
 * command can't span 360°. `clockwise` picks the sweep flag for both arcs;
 * using one shared keyframe (0%->100% offset-distance) for both directions
 * this way, rather than a mirrored keyframe, keeps the "which way does
 * this ring spin" decision entirely in the path's own winding direction.
 */
function ellipsePath(cx: number, cy: number, rx: number, ry: number, clockwise: boolean): string {
  const sweep = clockwise ? 1 : 0;
  // The arc command's x-axis-rotation parameter (ORBIT_BANK_DEG, in place
  // of the 0 used before) banks the ellipse in-plane — arcs support this
  // natively. The two arc endpoints have to actually move to the rotated
  // ellipse's own vertices for this to draw a true rotated ellipse though
  // — just adding the rotation parameter while leaving the endpoints at
  // the *unrotated* (cx±rx, cy) would bend the arcs into a lopsided shape
  // instead of a cleanly rotated one, since those points generally aren't
  // on the rotated ellipse at all.
  const rad = (ORBIT_BANK_DEG * Math.PI) / 180;
  const p1x = cx + rx * Math.cos(rad);
  const p1y = cy + rx * Math.sin(rad);
  const p2x = cx - rx * Math.cos(rad);
  const p2y = cy - rx * Math.sin(rad);
  return `M ${p1x},${p1y} A ${rx},${ry} ${ORBIT_BANK_DEG} 1,${sweep} ${p2x},${p2y} A ${rx},${ry} ${ORBIT_BANK_DEG} 1,${sweep} ${p1x},${p1y}`;
}

interface OrbitingAgent {
  agent: AgentData;
  radius: number;
  durationSec: number;
  delaySec: number;
  clockwise: boolean;
}

/**
 * Measures its own rendered width (via ResizeObserver) rather than relying
 * on breakpoint classes for ring radii — a CSS percentage in `transform`
 * resolves against the *node's own* box, not the ring container's, so
 * radii have to be computed in JS from the real container size to scale
 * correctly at arbitrary viewport widths instead of just at a few
 * breakpoints.
 */
export function OrbitView({ agents, maxState, onNodeClick, onMaxClick, registerNodeRef }: OrbitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(600);

  // Measures the *parent's* available box, not this element's own — sizing
  // this element purely from its own width (the old aspect-square + w-full
  // approach) never accounted for available height, so on a viewport
  // short enough that the resulting square was taller than the remaining
  // space, it overflowed and forced the whole page to scroll. Fitting to
  // min(availableWidth, availableHeight) guarantees it never exceeds
  // either, and observing the parent (rather than this element) avoids a
  // feedback loop of this element's own size affecting its own measurement.
  useEffect(() => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      // No hard px cap (was 820) — fill however much space is actually
      // available instead of stopping well short of it on large viewports.
      // The *0.92 leaves a visible gutter on all sides rather than running
      // literally edge-to-edge against the available box.
      if (rect) setSize(Math.min(rect.width, rect.height) * 0.99);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Only enabled agents orbit — a disabled one isn't rendered at all (not
  // grayed out, not present-but-hidden), so the ring always reflects
  // exactly the live count and re-spaces itself automatically as agents
  // are enabled/disabled over time.
  const enabledAgents = agents.filter((a) => a.enabled);
  const innerAgents = enabledAgents.filter((a) => getAgentVisual(a.key).ring === "inner");
  const outerAgents = enabledAgents.filter((a) => getAgentVisual(a.key).ring === "outer");

  const cx = size / 2;
  const cy = size / 2;
  // MAX's core and each agent node scale with the orbit's own measured
  // size (ratios from the confirmed mockup: ~76px MAX / ~36px node in a
  // ~600px-wide orbit) rather than staying a fixed CSS size — otherwise
  // widening the orbit alone makes MAX/nodes look disproportionately
  // small next to the now-bigger rings.
  const maxCoreSize = size * 0.127;
  const nodeSize = size * 0.06;

  // When only one of the two ring groups actually has agents in it (the
  // real case right now — 2 enabled agents, both "inner"), that group gets
  // the FULL band instead of being confined to its own narrow half. With
  // both bands fixed at [0.22,0.34]/[0.44,0.5] regardless of who's
  // populated, an inner-only orbit's visible rings topped out at 0.34 —
  // 68% of the container's own size, not the ~99% the container itself
  // was already correctly measuring. This is what actually made the whole
  // orbit read as small: not the container, the unused outer half of it.
  const hasInner = innerAgents.length > 0;
  const hasOuter = outerAgents.length > 0;
  // 0.49 (right at the container edge) clipped a node's label against the
  // container's overflow-hidden — a node's own label extends further left
  // /right than the node itself, so the safe ceiling has to leave room for
  // that, not just the node's own radius. 0.47 clipped a label against the
  // container edge (measured); 0.455 is the verified-safe ceiling.
  const innerBand: [number, number] = hasOuter ? INNER_BAND : [INNER_BAND[0], 0.455];
  const outerBand: [number, number] = hasInner ? OUTER_BAND : [0.28, 0.455];

  const orbiting: OrbitingAgent[] = [
    ...innerAgents.map((agent, i, arr) => ({
      agent,
      radius: spread(i, arr.length, innerBand) * size,
      // +/-15% speed jitter per agent within a ring — real orbits at
      // different radii don't move in lockstep either, and it reads as
      // more organic than every inner-ring node ticking in perfect unison.
      durationSec: INNER_DURATION_BASE * (0.85 + 0.3 * (arr.length <= 1 ? 0.5 : i / (arr.length - 1))),
      delaySec: -((i / arr.length) * INNER_DURATION_BASE),
      clockwise: true,
    })),
    ...outerAgents.map((agent, i, arr) => ({
      agent,
      radius: spread(i, arr.length, outerBand) * size,
      durationSec: OUTER_DURATION_BASE * (0.85 + 0.3 * (arr.length <= 1 ? 0.5 : i / (arr.length - 1))),
      delaySec: -((i / arr.length) * OUTER_DURATION_BASE),
      clockwise: false,
    })),
  ];

  const maxRadius = Math.max(size * OUTER_BAND[1], ...orbiting.map((o) => o.radius));

  return (
    <div
      ref={containerRef}
      // Explicit pixel size from the JS-measured `size` (below), not
      // CSS aspect-square/w-full — those size purely from available
      // width, blind to height, which is exactly what let this box
      // render larger than the actual available vertical space and get
      // silently cropped by the parent's overflow-hidden, while the ring
      // math (correctly using the height-aware `size`) drew a smaller
      // orbit centered on that oversized, cropped box's center rather
      // than the visible box's real center.
      className="relative mx-auto overflow-hidden"
      style={{ width: size, height: size }}
    >
      {/*
        Ring outlines and the radar sweep are static shapes (nothing here
        rotates them), so a plain ancestor scaleY squash is exactly correct
        for them — no composition-with-rotation problem, unlike the nodes
        below. MAX's core is rendered outside this wrapper, further down,
        so it stays flat/centered as specified.
      */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ transform: `rotate(${ORBIT_BANK_DEG}deg) scaleY(${ORBIT_TILT_Y_SCALE})` }}
      >
        {/* One faint path outline per agent's own actual radius, not just two shared circles — matches each agent now genuinely having its own orbit. */}
        {orbiting.map((o) => (
          <div
            key={o.agent.key}
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ width: o.radius * 2, height: o.radius * 2, border: "1.5px solid rgba(127, 217, 216, 0.18)" }}
          />
        ))}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ width: maxRadius * 2, height: maxRadius * 2 }}
        >
          <div className="radar-sweep h-full w-full" />
        </div>
      </div>

      {/*
        Nodes travel along a real elliptical `offset-path` (see
        AgentNode.tsx and ellipsePath() above) instead of living inside a
        rotating ancestor — a rotating container + ancestor scaleY can't
        correctly produce elliptical motion (scaleY doesn't commute with
        rotation), which is what caused nodes/labels to visibly stretch and
        shear at points around the loop. offset-path has no such problem:
        the path itself is already the ellipse.
      */}
      {orbiting.map((o) => (
        <AgentNode
          key={o.agent.key}
          agent={o.agent}
          visual={getAgentVisual(o.agent.key)}
          pathD={ellipsePath(cx, cy, o.radius, o.radius * ORBIT_TILT_Y_SCALE, o.clockwise)}
          durationSec={o.durationSec}
          delaySec={o.delaySec}
          active={hasRecentActivity(o.agent)}
          onClick={() => onNodeClick(o.agent.key)}
          size={nodeSize}
          registerRef={(el) => registerNodeRef(o.agent.key, el)}
        />
      ))}

      <MaxCore state={maxState} onClick={onMaxClick} size={maxCoreSize} />
    </div>
  );
}
