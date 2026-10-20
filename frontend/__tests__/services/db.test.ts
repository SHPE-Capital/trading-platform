import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabaseClient", () => ({ requireSupabase: () => { throw new Error("not used"); } }));

import { mapBacktestRow, mapFill, mapOrder, mapPendingApproval, mapVersion } from "../../services/db";

describe("db mappers", () => {
  it("maps an orders row the way the backend endpoint did", () => {
    const order = mapOrder({
      id: "o1", broker_order_id: null, strategy_id: "s", symbol: "SPY", side: "buy", qty: "10", filled_qty: "4",
      avg_fill_price: "101.5", order_type: "market", limit_price: null, status: "partial_fill",
      submitted_at: "2026-10-20T14:00:00Z", updated_at: "2026-10-20T14:00:01Z", closed_at: null,
      run_id: "r1", decision_price: null,
    });
    expect(order).toMatchObject({
      qty: 10, filledQty: 4, avgFillPrice: 101.5, limitPrice: undefined, decisionPrice: undefined,
      submittedAt: Date.parse("2026-10-20T14:00:00Z"), closedAt: undefined, runId: "r1", fills: [],
    });
  });

  it("maps a fills row with numbers and both timestamp forms", () => {
    expect(mapFill({
      id: "f1", order_id: "o1", symbol: "SPY", side: "sell", qty: "2", price: "100", notional: "200",
      commission: null, ts: "2026-10-20T14:00:00Z", run_id: null,
    })).toEqual({
      id: "f1", orderId: "o1", symbol: "SPY", side: "sell", qty: 2, price: 100, notional: 200, commission: 0,
      ts: Date.parse("2026-10-20T14:00:00Z"), isoTs: "2026-10-20T14:00:00Z", runId: undefined,
    });
  });

  it("names a version's author from the embedded app_users row", () => {
    const v = mapVersion({
      id: "v1", strategy_id: "s", version_number: 3, config: {}, change_summary: null, created_by: "u",
      created_at: "2026-10-20T14:00:00Z", app_users: { display_name: "Ana" }, algorithm_version: 2,
    });
    expect(v).toMatchObject({ versionNumber: 3, createdByName: "Ana", algorithmVersion: 2, changeSummary: null });
  });

  it("converts review-queue timestamps and counts", () => {
    const p = mapPendingApproval({
      proposal_id: "p", title: "t", requested_at: "2026-10-20T14:00:00Z", version_created_at: "2026-10-19T14:00:00Z",
      latest_backtest_at: null, backtest_count: "2", comment_count: null, changes_requested: 0,
    });
    expect(p).toMatchObject({
      requestedAt: Date.parse("2026-10-20T14:00:00Z"), latestBacktestAt: null, backtestCount: 2, commentCount: 0, changesRequested: false,
    });
  });

  it("gives backtests numeric timestamps, so sorting and durations work", () => {
    const b = mapBacktestRow({
      id: "b", status: "completed", started_at: "2026-10-20T14:00:00Z", completed_at: "2026-10-20T14:00:30Z",
      saved_at: null, error_message: null,
    });
    expect((b.completed_at ?? 0) - b.started_at).toBe(30_000);
    expect(b.saved_at).toBeUndefined();
    expect(b.error_message).toBeUndefined();
  });
});
