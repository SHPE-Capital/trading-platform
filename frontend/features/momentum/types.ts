/**
 * features/momentum/types.ts
 *
 * Shape of the momentum live page's data. This is the seam P3-1 fills: the
 * backend GET endpoints (active weekly config, live status) should return this
 * shape, or an adapter in dataSource.ts maps theirs onto it. Every tunable the
 * page displays (hold limit, halt line, grid parameters) arrives in the data
 * from the protocol config; the UI holds no strategy constants.
 */

export type MomentumPolicy = "similarity" | "recency" | "static";

export interface MomentumActiveConfig {
  /** Protocol config id (hash) of the weekly selection. */
  configId: string;
  policy: MomentumPolicy;
  /** ISO date the config became active (Monday of the week). */
  activationWeek: string;
  /** ISO timestamp the weekly artifact was produced. */
  artifactCreatedAt: string;
  /** Artifact older than this many hours is shown as stale. */
  freshnessLimitHours: number;
  /** Set when the calibration chose not to deploy this week. */
  noDeploymentReason: string | null;
  params: {
    breakoutMinutes: number;
    emaFast: number;
    emaSlow: number;
    rvolWindow: number;
    rvolMin: number;
    adxPeriod: number | null;
    adxMin: number | null;
  };
  exit: { maxHoldMinutes: number; initialStopAtr: number; sessionExitMinutesBeforeClose: number };
}

export interface MomentumUniverse {
  size: number;
  /** A sample of symbols for display; the full list lives in the artifact. */
  sample: string[];
}

export interface MomentumPosition {
  symbol: string;
  qty: number;
  entryPrice: number;
  lastPrice: number;
  stopPrice: number;
  /** ISO timestamp of the entry fill. */
  enteredAt: string;
}

export interface MomentumOrderAuditStep {
  /** e.g. signal, risk_check, order, fill, exit. */
  stage: string;
  at: string;
  detail: string;
}

export interface MomentumOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  status: "filled" | "rejected" | "canceled" | "open";
  at: string;
  /** Audit chain from P2-6: signal -> risk -> order -> fill. */
  audit: MomentumOrderAuditStep[];
}

export interface MomentumLiveSnapshot {
  config: MomentumActiveConfig;
  universe: MomentumUniverse;
  entries: { enabled: boolean; reason: string | null };
  halt: {
    /** Day PnL as a fraction of start-of-day equity (negative = loss). */
    dayPnlPct: number;
    dayPnl: number;
    /** Halt triggers when dayPnlPct <= -haltPct (config account.daily_halt_pct). */
    haltPct: number;
    halted: boolean;
  };
  positions: MomentumPosition[];
  orders: MomentumOrder[];
  lastBarAt: string | null;
  asOf: string;
}

/** Swap the mock for the P3-1 API client by implementing this. */
export interface MomentumDataSource {
  getLive(): Promise<MomentumLiveSnapshot>;
}
