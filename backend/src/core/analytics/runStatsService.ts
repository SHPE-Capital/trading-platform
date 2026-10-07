/**
 * core/analytics/runStatsService.ts
 *
 * Recomputes runs' stats from their ledger and stores them, so the run list
 * shows real numbers without rebuilding every run on each request. The ledger
 * refreshes the runs it touched after each pass; a read of a run with no
 * stored stats computes them on the spot.
 */

import { computeRunStats, type RunLedger } from "./runPerformance";
import { logger } from "../../utils/logger";
import type { StrategyRun } from "../../types/strategy";
import type { StrategyRunStats } from "../../types/analytics";

export interface RunStatsDeps {
  getRun(runId: string): Promise<StrategyRun | null>;
  loadLedger(run: StrategyRun): Promise<RunLedger>;
  upsert(stats: StrategyRunStats[]): Promise<void>;
  now?: () => number;
}

export class RunStatsService {
  constructor(private readonly deps: RunStatsDeps) {}

  async refresh(runIds: string[], marks: Map<string, number> = new Map()): Promise<StrategyRunStats[]> {
    const out: StrategyRunStats[] = [];
    for (const runId of new Set(runIds)) {
      try {
        const run = await this.deps.getRun(runId);
        if (!run) continue;
        out.push(computeRunStats(await this.deps.loadLedger(run), marks, (this.deps.now ?? Date.now)()));
      } catch (err) {
        logger.warn("RunStatsService: could not refresh run stats", { runId, err: String(err) });
      }
    }
    await this.deps.upsert(out);
    return out;
  }
}
