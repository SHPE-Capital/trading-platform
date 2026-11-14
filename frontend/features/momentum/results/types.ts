/**
 * features/momentum/results/types.ts
 *
 * Shape of the E2 policy-comparison JSON summary (scripts/momentum/report.py).
 * The momentum-tasks-E-evaluation.md packet lists the contents but not a wire
 * schema, so this is the dashboard's contract: E2 should emit this, or an
 * adapter in client.ts maps its output onto it. Returns are fractions (0.01 = 1%).
 */

export type ResultsPolicy = "similarity" | "recency" | "uniform";

export interface ResultsMeta {
  strategy: string;
  dataVersion: string;
  /** Cost model applied to the headline numbers, e.g. "10 bps per side". */
  costModel: string;
  /** Forward (out-of-sample) period shown on every chart. */
  forwardPeriod: { start: string; end: string };
  generatedAt: string;
}

export interface PolicySummary {
  policy: ResultsPolicy;
  cumulativeNetReturn: number;
  endingEquity: number;
  maxDrawdown: number;
  avgDailyReturn: number;
  downsideDeviation: number;
  tradeCount: number;
  activeDays: number;
  noDeploymentWeeks: number;
  avgHoldMinutes: number;
  exposure: number;
  turnover: number;
  rejectedSignals: number;
  /** Share of total net P&L from the top 5 weeks / top 5 stocks. */
  concentration: { topWeeksShare: number; topStocksShare: number };
  calibrationRuntimeSeconds: number;
}

export interface EquityPoint {
  date: string;
  similarity: number;
  recency: number;
  uniform: number;
}

export interface PairedDifference {
  /** Mean daily net return of Similarity minus Recency on paired dates. */
  meanDaily: number;
  nDays: number;
  resamples: number;
  /** One primary block length plus sensitivity block lengths. */
  intervals: { blockLength: number; primary: boolean; lo: number; hi: number }[];
}

export interface CostSensitivityRow {
  bps: number;
  similarity: number;
  recency: number;
  uniform: number;
}

/** configId is null for a no-deployment week. */
export interface WeeklyChoice {
  configId: string | null;
  netReturn: number;
  noDeploymentReason: string | null;
}

export interface WeeklyRow {
  weekStart: string;
  similarity: WeeklyChoice;
  recency: WeeklyChoice;
  uniform: WeeklyChoice;
}

export interface MomentumResultsSummary {
  meta: ResultsMeta;
  policies: PolicySummary[];
  equity: EquityPoint[];
  paired: PairedDifference;
  costSensitivity: CostSensitivityRow[];
  weekly: WeeklyRow[];
}

/** The seam P3-1 fills: swap `mockResultsClient` for an HTTP client in client.ts. */
export interface MomentumResultsClient {
  getSummary(): Promise<MomentumResultsSummary>;
}
