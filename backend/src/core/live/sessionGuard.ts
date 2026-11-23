/**
 * core/live/sessionGuard.ts
 *
 * Pre-open and restart guard for the momentum strategy (P2-5). Pure and
 * dependency-injected: it never talks to the broker itself. Every check that
 * fails or cannot be completed disables NEW ENTRIES with a reason code (fail
 * closed). Exits are never disabled: open positions keep their protection
 * config and are reported in `protectedSymbols`.
 *
 * Inputs:  injected calendar, account, broker/internal state, health probes,
 *          and the WeeklyConfigManager resolution.
 * Outputs: SessionGuardDecision from check(); entriesAllowed() for the hot path.
 */

import type { ConfigResolution, EntriesDisabledReason } from "../../strategies/momentum/weeklyConfigLoader";
import type { WeeklyConfig } from "../../strategies/momentum/weeklyConfig";

export type GuardReasonCode =
  | `config_${EntriesDisabledReason}`
  | "calendar_unavailable"
  | "not_trading_day"
  | "session_closed"
  | "entry_window_closed"
  | "account_unreadable"
  | "account_not_dedicated"
  | "broker_unreachable"
  | "position_mismatch"
  | "order_mismatch"
  | "data_connection_down"
  | "data_stale"
  | "order_connection_down"
  | "health_check_error";

export interface GuardReason {
  code: GuardReasonCode;
  detail: string;
}

export interface SessionInfo {
  isTradingDay: boolean;
  /** Epoch ms of the regular open and the (possibly early) close. */
  openMs: number;
  closeMs: number;
  earlyClose: boolean;
}

export interface PositionSnapshot { symbol: string; qty: number }
export interface OrderSnapshot { orderId: string; symbol: string }

export interface SessionGuardDeps {
  /** Resolves the weekly config; WeeklyConfigManager.resolve satisfies this. */
  resolveConfig(sessionDate: string, flat: boolean): ConfigResolution;
  getSession(sessionDate: string): Promise<SessionInfo | null>;
  getBrokerAccountNumber(): Promise<string>;
  getBrokerPositions(): Promise<PositionSnapshot[]>;
  getBrokerOpenOrders(): Promise<OrderSnapshot[]>;
  getInternalPositions(): PositionSnapshot[];
  getInternalOpenOrders(): OrderSnapshot[];
  /** lastDataAtMs is null when nothing has been received. */
  getDataStatus(): { connected: boolean; lastDataAtMs: number | null };
  getOrderConnectionStatus(): { connected: boolean };
  nowMs(): number;
}

export interface SessionGuardOptions {
  /** Account numbers allowed to trade this strategy (the dedicated paper account). */
  allowedAccountNumbers: readonly string[];
  /** Max age of the latest data message before the feed counts as stale. */
  dataMaxAgeMs: number;
  /** |broker qty - internal qty| above this is a mismatch. */
  positionQtyTolerance: number;
}

export interface SessionGuardDecision {
  entriesAllowed: boolean;
  reasons: GuardReason[];
  entryConfig: WeeklyConfig | null;
  /** Config open positions' exits keep using. */
  protectionConfig: WeeklyConfig | null;
  /** Union of broker and internal open symbols: exits and stops must stay live for these. */
  protectedSymbols: string[];
  /** Exits are never disabled by the guard. */
  exitsAllowed: true;
  checkedAtMs: number;
}

export class SessionGuard {
  private last: SessionGuardDecision | null = null;

  constructor(private readonly deps: SessionGuardDeps, private readonly opts: SessionGuardOptions) {}

  /** Call on process start (also mid-session): entries stay off until check() passes. */
  markRestart(): void {
    this.last = null;
  }

  /** Hot-path gate: false until a passing check() has run (fail closed). */
  entriesAllowed(): boolean {
    return this.last !== null && this.last.entriesAllowed;
  }

  get lastDecision(): SessionGuardDecision | null {
    return this.last;
  }

  /** Runs every check. Never throws; a failing probe becomes a reason. */
  async check(sessionDate: string): Promise<SessionGuardDecision> {
    const reasons: GuardReason[] = [];
    const add = (code: GuardReasonCode, detail: string): void => {
      reasons.push({ code, detail });
    };
    const now = this.deps.nowMs();

    // Broker state first: it decides whether we are provably flat.
    let brokerPositions: PositionSnapshot[] | null = null;
    let brokerOrders: OrderSnapshot[] | null = null;
    try {
      [brokerPositions, brokerOrders] = await Promise.all([
        this.deps.getBrokerPositions(),
        this.deps.getBrokerOpenOrders(),
      ]);
    } catch (e) {
      brokerPositions = null;
      brokerOrders = null;
      add("broker_unreachable", errMsg(e));
    }
    let internalPositions: PositionSnapshot[] = [];
    let internalOrders: OrderSnapshot[] = [];
    try {
      internalPositions = this.deps.getInternalPositions();
      internalOrders = this.deps.getInternalOpenOrders();
    } catch (e) {
      add("health_check_error", `internal state: ${errMsg(e)}`);
    }
    const flat =
      brokerPositions !== null &&
      brokerPositions.every((p) => p.qty === 0) &&
      internalPositions.every((p) => p.qty === 0);

    if (brokerPositions !== null && brokerOrders !== null) {
      this.reconcile(brokerPositions, brokerOrders, internalPositions, internalOrders, add);
    }

    // Config.
    let resolution: ConfigResolution | null = null;
    try {
      resolution = this.deps.resolveConfig(sessionDate, flat);
      if (!resolution.entriesAllowed) {
        add(
          `config_${resolution.reason ?? "invalid"}` as GuardReasonCode,
          resolution.errors.join("; ") || "weekly config blocks entries",
        );
      }
    } catch (e) {
      add("config_invalid", errMsg(e));
    }

    // Calendar, including early closes.
    let pastOpen = false;
    try {
      const session = await this.deps.getSession(sessionDate);
      if (session === null) {
        add("calendar_unavailable", `no calendar entry for ${sessionDate}`);
      } else if (!session.isTradingDay) {
        add("not_trading_day", sessionDate);
      } else if (now >= session.closeMs) {
        add("session_closed", session.earlyClose ? "early close passed" : "regular close passed");
      } else {
        pastOpen = now >= session.openMs;
        if (resolution?.entryConfig) {
          const minutes = resolution.entryConfig.account.exit.session_exit_minutes_before_close;
          if (now >= session.closeMs - minutes * 60_000) {
            add("entry_window_closed", `entries stop ${minutes} min before close`);
          }
        }
      }
    } catch (e) {
      add("calendar_unavailable", errMsg(e));
    }

    // Account.
    try {
      const acct = await this.deps.getBrokerAccountNumber();
      if (!this.opts.allowedAccountNumbers.includes(acct)) {
        add("account_not_dedicated", `account ${acct} is not an allowed account`);
      }
    } catch (e) {
      add("account_unreadable", errMsg(e));
    }

    // Connections. Freshness is only enforced once the session is open.
    try {
      const data = this.deps.getDataStatus();
      if (!data.connected) {
        add("data_connection_down", "market data disconnected");
      } else if (pastOpen && (data.lastDataAtMs === null || now - data.lastDataAtMs > this.opts.dataMaxAgeMs)) {
        add("data_stale", data.lastDataAtMs === null ? "no data received" : `last data ${now - data.lastDataAtMs} ms old`);
      }
      if (!this.deps.getOrderConnectionStatus().connected) {
        add("order_connection_down", "order stream disconnected");
      }
    } catch (e) {
      add("health_check_error", errMsg(e));
    }

    const allowed = reasons.length === 0 && resolution !== null && resolution.entriesAllowed;
    const protectedSymbols = [
      ...new Set([...(brokerPositions ?? []), ...internalPositions].filter((p) => p.qty !== 0).map((p) => p.symbol)),
    ].sort();
    const decision: SessionGuardDecision = {
      entriesAllowed: allowed,
      reasons,
      entryConfig: allowed && resolution !== null ? resolution.entryConfig : null,
      protectionConfig: resolution?.protectionConfig ?? null,
      protectedSymbols,
      exitsAllowed: true,
      checkedAtMs: now,
    };
    this.last = decision;
    return decision;
  }

  private reconcile(
    bp: PositionSnapshot[],
    bo: OrderSnapshot[],
    ip: PositionSnapshot[],
    io: OrderSnapshot[],
    add: (c: GuardReasonCode, d: string) => void,
  ): void {
    const sum = (xs: PositionSnapshot[]): Map<string, number> => {
      const m = new Map<string, number>();
      for (const x of xs) if (x.qty !== 0) m.set(x.symbol, (m.get(x.symbol) ?? 0) + x.qty);
      return m;
    };
    const b = sum(bp);
    const i = sum(ip);
    const diffs: string[] = [];
    for (const s of new Set([...b.keys(), ...i.keys()])) {
      const bq = b.get(s) ?? 0;
      const iq = i.get(s) ?? 0;
      if (Math.abs(bq - iq) > this.opts.positionQtyTolerance) diffs.push(`${s}: broker ${bq} vs internal ${iq}`);
    }
    if (diffs.length) add("position_mismatch", diffs.join("; "));

    const bIds = new Set(bo.map((o) => o.orderId));
    const iIds = new Set(io.map((o) => o.orderId));
    const odiff = [
      ...[...bIds].filter((x) => !iIds.has(x)).map((x) => `broker-only ${x}`),
      ...[...iIds].filter((x) => !bIds.has(x)).map((x) => `internal-only ${x}`),
    ];
    if (odiff.length) add("order_mismatch", odiff.join("; "));
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
