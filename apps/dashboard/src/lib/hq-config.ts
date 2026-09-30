import {
  IconTarget,
  IconCompass,
  IconMapPin,
  IconFeather,
  IconEye,
  IconSpeakerphone,
  IconRocket,
  IconReceipt2,
  IconMailOpened,
  IconChartCandle,
  IconCrown,
  IconMovie,
  IconBook2,
  IconSchool,
  IconTag,
  IconTelescope,
  IconSunHigh,
  IconFlame,
  type Icon,
} from "@tabler/icons-react";

/**
 * Display-only metadata for the orbit view — icon, accent color, which ring,
 * and (for the 3 agents that actually have source code) how many sources
 * they poll. None of this lives in the DB: it's purely a UI concern, and
 * keeping it here avoids touching apps/core or the schema for a UI-only
 * build. Icons are thematic per the spec (a role icon, not a platform
 * logo) — verified against the installed @tabler/icons-react package
 * before use, not guessed at.
 *
 * Source counts are manually kept in sync with each agent's ALL_SOURCES
 * array in apps/core — there's no automatic link between the two apps for
 * this. Update here when a source is added/removed for job-scout,
 * alpha-scout, or wl-hunter.
 */
export interface AgentVisual {
  icon: Icon;
  color: string; // hex, used for gradient fill / glow / label accent
  ring: "inner" | "outer";
  hasSaturnRing: boolean;
  sourceCount: number; // 0 for agents with no code yet
}

// Colors are the Tailwind ~700 shade of each hue (darker, muted) rather
// than the vivid ~500 shades used originally — the white/black radial
// shading layered on top in AgentNode.tsx already does the "make it read
// as a lit sphere" work, so a dark base color reads as a dark planet with
// a glow, not just a dim/washed-out bright one.
export const AGENT_VISUALS: Record<string, AgentVisual> = {
  "job-scout": { icon: IconTarget, color: "#065f46", ring: "inner", hasSaturnRing: true, sourceCount: 12 },
  "alpha-scout": { icon: IconCompass, color: "#6b21a8", ring: "inner", hasSaturnRing: false, sourceCount: 5 },
  "apartment-scout": { icon: IconMapPin, color: "#047857", ring: "inner", hasSaturnRing: true, sourceCount: 0 },
  "x-content": { icon: IconFeather, color: "#0369a1", ring: "inner", hasSaturnRing: false, sourceCount: 0 },
  "email-watcher": { icon: IconEye, color: "#0f766e", ring: "inner", hasSaturnRing: true, sourceCount: 0 },
  "wl-hunter": { icon: IconCrown, color: "#a21caf", ring: "inner", hasSaturnRing: false, sourceCount: 2 },
  "telegram-manager": { icon: IconSpeakerphone, color: "#0e7490", ring: "outer", hasSaturnRing: true, sourceCount: 0 },
  "yc-assistant": { icon: IconRocket, color: "#c2410c", ring: "outer", hasSaturnRing: false, sourceCount: 0 },
  "invoice-followup": { icon: IconReceipt2, color: "#be123c", ring: "outer", hasSaturnRing: true, sourceCount: 0 },
  "inbox-triage": { icon: IconMailOpened, color: "#4d7c0f", ring: "outer", hasSaturnRing: false, sourceCount: 0 },
  "mst-bot": { icon: IconChartCandle, color: "#b91c1c", ring: "outer", hasSaturnRing: true, sourceCount: 0 },
  "youtube-manager": { icon: IconMovie, color: "#7e22ce", ring: "outer", hasSaturnRing: false, sourceCount: 0 },
  "novel-companion": { icon: IconBook2, color: "#be185d", ring: "outer", hasSaturnRing: true, sourceCount: 0 },
  "learning-tracker": { icon: IconSchool, color: "#4338ca", ring: "outer", hasSaturnRing: false, sourceCount: 0 },
  "deal-scout": { icon: IconTag, color: "#a16207", ring: "outer", hasSaturnRing: true, sourceCount: 0 },
  "market-watcher": { icon: IconTelescope, color: "#1d4ed8", ring: "outer", hasSaturnRing: false, sourceCount: 0 },
  "daily-briefing": { icon: IconSunHigh, color: "#9f1239", ring: "outer", hasSaturnRing: true, sourceCount: 0 },
  // Added — this agent was registered in AGENT_REGISTRY (and enabled in the
  // DB) with no matching entry here, so it was silently rendering with the
  // generic gray FALLBACK_VISUAL below instead of its own icon/color.
  "degen-hunter": { icon: IconFlame, color: "#b45309", ring: "outer", hasSaturnRing: true, sourceCount: 1 },
};

const FALLBACK_VISUAL: AgentVisual = {
  icon: IconTarget,
  color: "#94a3b8",
  ring: "outer",
  hasSaturnRing: false,
  sourceCount: 0,
};

export function getAgentVisual(key: string): AgentVisual {
  return AGENT_VISUALS[key] ?? FALLBACK_VISUAL;
}

/** Total sources across only the given (usually: enabled) agent keys. */
export function totalSourceCount(agentKeys: string[]): number {
  return agentKeys.reduce((sum, key) => sum + getAgentVisual(key).sourceCount, 0);
}
