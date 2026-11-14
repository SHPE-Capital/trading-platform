/** Pure helpers for the results view. */
import type { PairedDifference, ResultsMeta, ResultsPolicy } from "./types";

export const POLICY_NAMES: Record<ResultsPolicy, string> = {
  similarity: "Similarity",
  recency: "Recency",
  uniform: "Uniform",
};

/** Colour-blind-safe series colours (Okabe-Ito). */
export const POLICY_COLORS: Record<ResultsPolicy, string> = {
  similarity: "#0072B2",
  recency: "#D55E00",
  uniform: "#7f7f7f",
};

export function signedPct(n: number, digits = 2): string {
  return `${n >= 0 ? "+" : "-"}${(Math.abs(n) * 100).toFixed(digits)}%`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Caption required on every chart: strategy, data version, cost model, forward period. */
export function chartLabel(meta: ResultsMeta): string {
  return `${meta.strategy} · data ${meta.dataVersion} · costs ${meta.costModel} · forward ${meta.forwardPeriod.start} to ${meta.forwardPeriod.end}`;
}

/** True when the primary interval excludes zero. */
export function pairedExcludesZero(p: PairedDifference): boolean {
  const primary = p.intervals.find((i) => i.primary);
  return !!primary && (primary.lo > 0 || primary.hi < 0);
}

/** Linear scale for the SVG charts; a flat domain maps to the middle. */
export function scale(v: number, d0: number, d1: number, r0: number, r1: number): number {
  return d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}
