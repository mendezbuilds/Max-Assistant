// Subpath import on purpose: @max/shared's main entry also pulls in Node-only code
// (crypto, the database), which can't go into a browser bundle. This module is pure.
import { assessRisk, type RiskAssessment } from "@max/shared/dist/risk-assessment";
import type { DashboardToken } from "./types";

export type RiskTag = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;

/**
 * The token's risk, from the shared assessment (the same one the Telegram bot
 * and the scanner use): the level is derived from the flags, so it can't
 * disagree with them. Computed from the token's data every time, so tokens
 * stored before this existed are assessed consistently too.
 *
 * This replaces logic that read flag names nothing ever produced
 * ("extreme-risk", "high-risk") and treated a LOW opportunity score as high risk
 * — the opposite of the Telegram label, which treated a HIGH score as high risk.
 */
export function assess(t: DashboardToken): RiskAssessment {
  return assessRisk(t);
}

/** Null (rendered "UNSCORED") only when essentially nothing is known about the token. */
export function riskTag(t: DashboardToken): RiskTag {
  const a = assessRisk(t);
  if (a.unverified.length >= 5) return null;
  return a.level.toUpperCase() as NonNullable<RiskTag>;
}

/** Tier names the Risk tab uses. */
export type RiskTier = "Low" | "Medium" | "High" | "Extreme";
export function riskTier(t: DashboardToken): RiskTier {
  const l = assessRisk(t).level;
  return l === "critical" ? "Extreme" : l === "high" ? "High" : l === "medium" ? "Medium" : "Low";
}

export const RISK_STYLE: Record<NonNullable<RiskTag> | "NONE", string> = {
  LOW: "text-emerald-400 bg-emerald-950/40 border-emerald-900/60",
  MEDIUM: "text-amber-400 bg-amber-950/40 border-amber-900/60",
  HIGH: "text-rose-400 bg-rose-950/40 border-rose-900/60",
  CRITICAL: "text-red-300 bg-red-950/70 border-red-700/70",
  NONE: "text-slate-400 bg-slate-900/40 border-slate-800",
};

/** The reasons behind the risk level, worst first (each carries the actual numbers). Empty only when the level is Low. */
export function tokenWarnings(t: DashboardToken): string[] {
  return assessRisk(t).warnings;
}

/** Checks that couldn't be run — "no flag" on these means unknown, not fine. */
export function tokenUnverified(t: DashboardToken): string[] {
  return assessRisk(t).unverified;
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function fmtAgeMin(minutes: number | undefined): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}
