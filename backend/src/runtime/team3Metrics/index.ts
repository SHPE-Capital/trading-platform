/**
 * runtime/team3Metrics/index.ts
 *
 * Stage 2 mechanism metrics, one file per goal session. The runner prints the
 * result under `mechanism` in TEAM3_ROW. Each session edits only its own file;
 * this registry is fixed. Owner: team lead.
 */

import type { MetricInput } from "./trades";
import { r1Metrics } from "./r1";
import { r2Metrics } from "./r2";
import { r4Metrics } from "./r4";
import { r5Metrics } from "./r5";
import { rspyMetrics } from "./rspy";

export type GoalMetric = (input: MetricInput) => Record<string, unknown>;

export const GOAL_METRICS: Record<string, GoalMetric> = {
  r1: r1Metrics, r2: r2Metrics, r4: r4Metrics, r5: r5Metrics, rspy: rspyMetrics,
};

/** Every goal's metrics; a goal that throws reports its error instead of failing the run. */
export function mechanismMetrics(input: MetricInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [goal, f] of Object.entries(GOAL_METRICS)) {
    try {
      const r = f(input);
      if (Object.keys(r).length) out[goal] = r;
    } catch (err) {
      out[goal] = { error: String(err) };
    }
  }
  return out;
}
