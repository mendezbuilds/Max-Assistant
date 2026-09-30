"use client";

import { useEffect, useState } from "react";

interface Star {
  id: number;
  xPct: number;
  yPct: number;
  size: number;
  duration: number;
  delay: number;
}

interface BrightStar {
  id: number;
  xPct: number;
  yPct: number;
  size: number;
}

/** A coordinate biased toward the 0-18% / 82-100% edges of the box, for the handful of "prominent" stars the spec wants near the border rather than scattered anywhere. */
function edgeBiasedPct(): number {
  return Math.random() < 0.5 ? Math.random() * 18 : 82 + Math.random() * 18;
}

function generateStars(count: number): Star[] {
  return Array.from({ length: count }, (_, id) => {
    const duration = 2 + Math.random() * 3; // 2-5s
    return {
      id,
      xPct: Math.random() * 100,
      yPct: Math.random() * 100,
      size: 1 + Math.random() * 1.5, // 1-2.5px
      duration,
      // Negative delay starts each star already mid-cycle at a random phase,
      // so they don't all begin in sync from the same opacity on mount.
      delay: -Math.random() * duration,
    };
  });
}

function generateBrightStars(count: number): BrightStar[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    xPct: edgeBiasedPct(),
    yPct: edgeBiasedPct(),
    size: 2.5 + Math.random() * 1.5, // 2.5-4px
  }));
}

/**
 * Random per-star placement/timing means this can only be generated
 * client-side — computing it during the render that produces the initial
 * SSR HTML would give the server and the hydrating client two different
 * random sets (same class of bug as `Date.now()` in TitleBar), so this
 * starts empty (matching what the server rendered) and fills in only after
 * mount, exactly like that fix.
 */
export function Starfield() {
  const [stars, setStars] = useState<Star[] | null>(null);
  const [brightStars, setBrightStars] = useState<BrightStar[] | null>(null);

  useEffect(() => {
    setStars(generateStars(140));
    setBrightStars(generateBrightStars(5));
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Two low-opacity corner color washes for depth — muted purple / muted teal, opposite corners. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 10% 12%, rgba(139, 92, 246, 0.12), transparent 45%), radial-gradient(circle at 90% 88%, rgba(20, 184, 166, 0.12), transparent 45%)",
        }}
      />
      {stars?.map((s) => (
        <span
          key={s.id}
          className="twinkle-star"
          style={{
            left: `${s.xPct}%`,
            top: `${s.yPct}%`,
            width: s.size,
            height: s.size,
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
      {brightStars?.map((s) => (
        <span
          key={s.id}
          className="bright-star"
          style={{ left: `${s.xPct}%`, top: `${s.yPct}%`, width: s.size, height: s.size }}
        />
      ))}
    </div>
  );
}
