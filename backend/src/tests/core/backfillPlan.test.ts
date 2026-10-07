import { planBackfill, type PlanOrder } from "../../core/ledger/backfillPlan";

const at = (iso: string) => Date.parse(iso);
let n = 0;
const order = (symbol: string, iso: string, extra: Partial<PlanOrder> = {}): PlanOrder => ({
  id: `o${++n}`, symbol, strategyId: "unattributed", submittedAt: at(iso), runId: null, ...extra,
});

describe("planBackfill (club history)", () => {
  it("recreates the Oct 6–7 minute-reversal run from its universe's orders", () => {
    const plan = planBackfill([
      order("TSLA", "2026-10-06T17:49:00Z"),
      order("MU", "2026-10-07T15:36:00Z"),
      order("F", "2026-10-07T04:21:00Z"), // smoke-test order outside the universe
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      symbols: ["MU", "TSLA"],
      startedAt: at("2026-10-06T17:49:00Z"),
      stoppedAt: at("2026-10-07T15:36:00Z"),
    });
    expect(plan[0].template).toMatchObject({ strategyType: "minute_reversal", runtimeOrigin: "local-docker", backfillKey: "minute-reversal-2026-10-06" });
  });

  it("recreates one legacy SPY/QQQ run per in-memory strategy id from May", () => {
    const plan = planBackfill([
      order("SPY", "2026-05-08T19:23:47Z", { strategyId: "8459f59a" }),
      order("QQQ", "2026-05-08T19:48:34Z", { strategyId: "e38ff9c1" }),
      order("SPY", "2026-05-08T19:59:18Z", { strategyId: "e38ff9c1" }),
    ]);
    expect(plan.map((p) => [p.template.backfillKey, p.orderIds.length])).toEqual([
      ["pairs-spy-qqq-2026-05:8459f59a", 1],
      ["pairs-spy-qqq-2026-05:e38ff9c1", 2],
    ]);
    expect(plan[1].template).toMatchObject({ strategyName: "Pairs: SPY/QQQ", config: { id: "e38ff9c1" } });
  });

  it("leaves orders that already have a run alone", () => {
    expect(planBackfill([order("TSLA", "2026-10-06T18:00:00Z", { runId: "r1" })])).toEqual([]);
  });
});
