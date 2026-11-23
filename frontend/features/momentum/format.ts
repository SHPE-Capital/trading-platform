/** Pure helpers for the momentum live page. All thresholds come from the snapshot. */
import type { MomentumActiveConfig, MomentumPosition } from "./types";

const POLICY_LABEL: Record<MomentumActiveConfig["policy"], string> = {
  similarity: "Similarity-weighted",
  recency: "Recency-weighted",
  static: "Static",
};

export function describeConfig(c: MomentumActiveConfig): string {
  const { params } = c;
  const parts = [
    `${params.breakoutMinutes}-minute breakout`,
    `EMA ${params.emaFast}/${params.emaSlow} trend`,
    `relative volume ≥ ${params.rvolMin} (${params.rvolWindow}-session)`,
  ];
  if (params.adxPeriod !== null && params.adxMin !== null) {
    parts.push(`ADX(${params.adxPeriod}) ≥ ${params.adxMin}`);
  }
  return `${parts.join(" + ")} — ${POLICY_LABEL[c.policy]} policy`;
}

export function artifactAgeHours(c: MomentumActiveConfig, now: Date): number {
  return (now.getTime() - new Date(c.artifactCreatedAt).getTime()) / 3_600_000;
}

export function isArtifactStale(c: MomentumActiveConfig, now: Date): boolean {
  return artifactAgeHours(c, now) > c.freshnessLimitHours;
}

/** Minutes until the max-hold exit; negative once overdue. */
export function minutesLeft(p: MomentumPosition, maxHoldMinutes: number, now: Date): number {
  const held = (now.getTime() - new Date(p.enteredAt).getTime()) / 60_000;
  return Math.round(maxHoldMinutes - held);
}

/** Fraction of the halt line already used by losses, clamped to [0, 1]. */
export function haltUsage(dayPnlPct: number, haltPct: number): number {
  if (haltPct <= 0 || dayPnlPct >= 0) return 0;
  return Math.min(1, -dayPnlPct / haltPct);
}

export function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function pct(n: number, digits = 2): string {
  return `${(n * 100).toFixed(digits)}%`;
}
