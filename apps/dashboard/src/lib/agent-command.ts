import { AGENT_REGISTRY } from "@max/shared";

/**
 * Same philosophy as core-command.ts: a small, hardcoded phrase match — not
 * an LLM decision — because this flips real state (an enabled agent starts
 * polling and sending Telegram messages on core's next tick). A command only
 * counts if it has an explicit verb AND an explicit target (an agent's real
 * name/key, or "all"), so general chatter never toggles anything.
 */

/**
 * Agents that have a runner in apps/core's AGENT_RUNNERS
 * (apps/core/src/agents/registry.ts). The dashboard can't import that module,
 * so this is a mirror — update both together. Agents outside this list exist
 * in the roster but have no code behind them, so enabling one would only flip
 * a flag that does nothing; Max refuses instead of claiming success.
 */
export const BUILT_AGENT_KEYS = new Set(["job-scout", "alpha-scout", "wl-hunter", "degen-hunter"]);

const OFF_VERB = /\b(disable|deactivate|pause|stop|shut\s*down)\b|\b(turn|switch)\b[^.]*\boff\b/i;
const ON_VERB = /\b(enable|activate|start|wake)\b|\b(turn|switch)\b[^.]*\bon\b/i;
const ALL_TARGET = /\ball\s+(of\s+)?((the|my)\s+)*agents\b|\bevery\s+agent\b/i;

export interface AgentCommand {
  action: "on" | "off";
  /** Agent keys explicitly named, or every roster key for "all". */
  keys: string[];
}

export function detectAgentCommand(text: string): AgentCommand | null {
  // OFF is checked first so "turn off X" can't also satisfy the ON pattern's "turn ... on" via a later word.
  const action = OFF_VERB.test(text) ? "off" : ON_VERB.test(text) ? "on" : null;
  if (!action) return null;

  const lower = text.toLowerCase();
  const named = AGENT_REGISTRY.filter((a) => lower.includes(a.name.toLowerCase()) || lower.includes(a.key.replace(/-/g, " ")));
  if (named.length > 0) return { action, keys: named.map((a) => a.key) };

  if (ALL_TARGET.test(text)) {
    return { action, keys: AGENT_REGISTRY.map((a) => a.key) };
  }
  return null;
}
