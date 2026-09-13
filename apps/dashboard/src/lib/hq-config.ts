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

export const AGENT_VISUALS: Record<string, AgentVisual> = {
  "job-scout": { icon: IconTarget, color: "#f59e0b", ring: "inner", hasSaturnRing: true, sourceCount: 12 },
  "alpha-scout": { icon: IconCompass, color: "#8b5cf6", ring: "inner", hasSaturnRing: false, sourceCount: 5 },
  "apartment-scout": { icon: IconMapPin, color: "#10b981", ring: "inner", hasSaturnRing: true, sourceCount: 0 },
  "x-content": { icon: IconFeather, color: "#0ea5e9", ring: "inner", hasSaturnRing: false, sourceCount: 0 },
  "email-watcher": { icon: IconEye, color: "#14b8a6", ring: "inner", hasSaturnRing: true, sourceCount: 0 },
  "wl-hunter": { icon: IconCrown, color: "#d946ef", ring: "inner", hasSaturnRing: false, sourceCount: 2 },
  "telegram-manager": { icon: IconSpeakerphone, color: "#06b6d4", ring: "outer", hasSaturnRing: true, sourceCount: 0 },
  "yc-assistant": { icon: IconRocket, color: "#f97316", ring: "outer", hasSaturnRing: false, sourceCount: 0 },
  "invoice-followup": { icon: IconReceipt2, color: "#f43f5e", ring: "outer", hasSaturnRing: true, sourceCount: 0 },
  "inbox-triage": { icon: IconMailOpened, color: "#84cc16", ring: "outer", hasSaturnRing: false, sourceCount: 0 },
  "mst-bot": { icon: IconChartCandle, color: "#ef4444", ring: "outer", hasSaturnRing: true, sourceCount: 0 },
  "youtube-manager": { icon: IconMovie, color: "#a855f7", ring: "outer", hasSaturnRing: false, sourceCount: 0 },
  "novel-companion": { icon: IconBook2, color: "#ec4899", ring: "outer", hasSaturnRing: true, sourceCount: 0 },
  "learning-tracker": { icon: IconSchool, color: "#6366f1", ring: "outer", hasSaturnRing: false, sourceCount: 0 },
  "deal-scout": { icon: IconTag, color: "#eab308", ring: "outer", hasSaturnRing: true, sourceCount: 0 },
  "market-watcher": { icon: IconTelescope, color: "#3b82f6", ring: "outer", hasSaturnRing: false, sourceCount: 0 },
  "daily-briefing": { icon: IconSunHigh, color: "#fb7185", ring: "outer", hasSaturnRing: true, sourceCount: 0 },
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
