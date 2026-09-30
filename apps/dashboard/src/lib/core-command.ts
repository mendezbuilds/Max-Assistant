/**
 * Deliberately small, hardcoded phrase matching — not an LLM decision.
 * This is the ONLY thing in the app that can start/stop a real process, so
 * it needs to be a short, auditable list of intentional phrasings rather
 * than "whatever Gemini thinks sounds like a start/stop request." Each
 * pattern requires an explicit verb + explicit target (core/system), or is
 * one of the two standalone phrases the spec named directly ("shut down",
 * "stop core") — general chatter about "the system" or "starting" or
 * "stopping" something unrelated won't match.
 */
const ON_PATTERNS = [/\b(turn|switch)\s+(the\s+)?(core|system)\s+on\b/i, /\bstart\s+(the\s+)?(core|system)\b/i, /\bboot\s+(up\s+)?(the\s+)?core\b/i];

const OFF_PATTERNS = [
  /\b(turn|switch)\s+(the\s+)?(core|system)\s+off\b/i,
  /\bstop\s+(the\s+)?core\b/i,
  /\bshut\s*down\b/i,
];

export function detectCoreCommand(text: string): "on" | "off" | null {
  if (OFF_PATTERNS.some((p) => p.test(text))) return "off";
  if (ON_PATTERNS.some((p) => p.test(text))) return "on";
  return null;
}
