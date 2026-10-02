"use client";

import { glowColor } from "@/lib/hq-config";
import type { AgentVisual } from "@/lib/hq-config";
import type { AgentData } from "./types";

interface AgentNodeProps {
  agent: AgentData;
  visual: AgentVisual;
  /** SVG path string (absolute px, in the orbit container's own coordinate space) the node travels along — see OrbitView's ellipsePath(). */
  pathD: string;
  durationSec: number;
  /** Negative seconds — how far into the loop this node starts, so nodes sharing one path end up evenly spaced around it instead of stacked at the path's start point. */
  delaySec: number;
  active: boolean;
  onClick: () => void;
  /** Sphere diameter in px, from the orbit's own measured size — see MaxCore's matching prop for why this isn't a fixed CSS size. */
  size: number;
  /** Attached to the actual icon sphere — the exact element whose real on-screen box is wanted for the zoom-to-detail effect's start rect. */
  registerRef?: (el: HTMLButtonElement | null) => void;
}

/**
 * Travels along a real elliptical path via CSS `offset-path` + animated
 * `offset-distance`, with `offset-rotate: 0deg` holding the node upright —
 * the browser computes the correct x/y along the true ellipse every frame,
 * which is what makes this different from (and correct where) an earlier
 * attempt wasn't: that version squashed the *rendered* position with a
 * scaleY on an ancestor of a *rotating* element, and undoing that squash
 * for the node's own shape took a counter-scaleY — but scaleY doesn't
 * commute with rotation, so the counter-scale only actually cancelled the
 * tilt at two points in the loop and visibly stretched the node/label into
 * an oval everywhere else. offset-path sidesteps the whole problem: the
 * path IS the ellipse, so there's no separate squash step to accidentally
 * leak into the node's own rendering, and no counter-transform needed at
 * all — offset-rotate: 0deg already guarantees upright orientation.
 *
 * The outer offset-path div is given an explicit 1x1px size rather than
 * left auto-sized to its children. `left-1/2 top-1/2 -translate-x/y-1/2`
 * centering (used for the icon button below) needs a containing block with
 * a real, non-zero size to resolve "50%" against — an absolutely
 * positioned element whose *own* children are all themselves absolutely
 * positioned (as they are here) collapses to 0x0, which would make every
 * "50%" resolve to 0 and silently break the centering. 1x1 gives a real,
 * if tiny, reference box; the actual placement then comes entirely from
 * offset-path plus the translate.
 */
export function AgentNode({ agent, visual, pathD, durationSec, delaySec, active, onClick, size, registerRef }: AgentNodeProps) {
  const Icon = visual.icon;

  return (
    <div
      className="pointer-events-none absolute left-0 top-0"
      style={{
        width: 1,
        height: 1,
        offsetPath: `path("${pathD}")`,
        offsetRotate: "0deg",
        offsetDistance: "0%",
        // Longhand properties, not the `animation` shorthand — React's
        // hydration check compares the server-rendered style string
        // against what the browser's CSSOM reports back after parsing it,
        // and shorthand properties get silently expanded into their
        // longhand components by the browser in that round-trip, which
        // read as a (harmless, but real and logged) mismatch. Setting the
        // same longhand properties React already expects sidesteps that.
        animationName: "orbit-travel",
        animationDuration: `${durationSec}s`,
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
        animationDelay: `${delaySec}s`,
      }}
    >
      {/*
        Centered EXACTLY on the path point (the anchor above) — the label
        below is a sibling anchored at the same point via a fixed
        margin-top instead of being stacked inside this same centered box,
        so its height can never shift where the icon itself sits (that's
        what put the icon visibly above the ring line before: centering a
        flex column of icon+gap+label centers the whole column, not just
        the icon, so the icon ends up above the true center by roughly
        half the label's height).
      */}
      <button
        ref={registerRef}
        onClick={onClick}
        className="group pointer-events-auto absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus:outline-none"
        style={{ width: size, height: size, ["--node-glow" as string]: glowColor(visual.color) }}
        aria-label={`Open ${agent.name}`}
      >
        {visual.hasSaturnRing && (
          // Sized larger than the sphere itself (not inset-0, which
          // matched the sphere's own box exactly and so never visibly
          // extended past its edges) — a real Saturn ring is wider than
          // the planet it circles.
          <div
            className="absolute left-1/2 top-1/2 rounded-full border-2"
            style={{
              width: "175%",
              height: "175%",
              transform: "translate(-50%, -50%) scaleY(0.35) rotate(-18deg)",
              borderColor: visual.color,
            }}
          />
        )}
        <div
          // Active (enabled): glows in its own color. Inactive: same node,
          // dimmed, and no glow at all.
          className={`relative flex h-full w-full items-center justify-center rounded-full transition-all ${
            active ? "node-active border-2" : "border opacity-45 saturate-50"
          }`}
          style={{
            // A fully opaque base fill (the last, plain-color layer) with
            // white/black shading layered on top and faded to
            // *transparent* rather than to a low-alpha version of the
            // node color — transparent here reveals the opaque base
            // underneath it, not whatever is behind the node, so the
            // sphere reads as solid all the way to its edge instead of
            // glassy/see-through.
            background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 45%), radial-gradient(circle at 68% 78%, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 60%), ${visual.color}`,
            // Opaque either way now — the active/inactive distinction lives
            // in the node-active glow (a box-shadow, not a fill/border
            // alpha) and the label's own text color, not in making the
            // node itself see-through when idle.
            borderColor: visual.color,
            boxShadow: `inset 0 2px 4px rgba(255,255,255,0.35), inset 0 -3px 6px rgba(0,0,0,0.35)`,
          }}
        >
          <Icon size={Math.round(size * 0.36)} stroke={1.75} className="text-white" />
        </div>
      </button>
      <span
        className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] tracking-wide ${
          active ? "text-slate-100" : "text-slate-500"
        }`}
        style={{ marginTop: size * 0.65 }}
      >
        {agent.name}
      </span>
    </div>
  );
}
