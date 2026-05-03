
import { insertBacktestResult, insertBacktestOrders, insertBacktestFills } from "../../src/adapters/supabase/repositories";
import { getSupabaseClient } from "../../src/adapters/supabase/client";
import { logger } from "../../src/utils/logger";

jest.mock("../../src/adapters/supabase/client");
jest.mock("../../src/utils/logger");

describe("repositories adapters", () => {
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockResolvedValue({ error: null }),
    };
    (getSupabaseClient as jest.Mock).mockReturnValue(mockSupabase);
  });

  test("insertBacktestResult: ISO timestamp conversion", async () => {
    const result: any = {
      id: "run-1",
      started_at: 1672531200000, // 2023-01-01
      completed_at: 1672531260000,
      equity_curve: [],
    };
    await insertBacktestResult(result);
    
    const payload = mockSupabase.insert.mock.calls[0][0];
    expect(payload.started_at).toBe("2023-01-01T00:00:00.000Z");
  });

  test("insertBacktestResult: throws on error", async () => {
    mockSupabase.insert.mockResolvedValue({ error: { message: "DB Error" } });
    const result: any = { 
      started_at: Date.now(), 
      completed_at: Date.now(),
      equity_curve: [] 
    };
    await expect(insertBacktestResult(result)).rejects.toThrow("Failed to insert backtest result: DB Error");
  });

  test("insertBacktestOrders: empty array is a no-op", async () => {
    await insertBacktestOrders("run-1", []);
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("insertBacktestOrders: no orders to insert", expect.anything());
  });

  test("insertBacktestOrders: chunked at 1000", async () => {
    const orders = Array.from({ length: 2500 }, (_, i) => ({ id: `o-${i}`, submittedAt: Date.now(), updatedAt: Date.now() }));
    await insertBacktestOrders("run-1", orders as any);
    
    expect(mockSupabase.from).toHaveBeenCalledWith("backtest_orders");
    expect(mockSupabase.insert).toHaveBeenCalledTimes(3); // 1000, 1000, 500
    
    const payload = mockSupabase.insert.mock.calls[0][0];
    expect(payload[0].backtest_id).toBe("run-1");
  });

  test("insertBacktestFills: empty array is a no-op", async () => {
    await insertBacktestFills("run-1", []);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  test("insertBacktestFills: writes to backtest_fills", async () => {
    const fills = [{ id: "f-1", orderId: "o-1", symbol: "SPY", side: "buy", qty: 10, price: 400, notional: 4000, commission: 0, ts: Date.now() }];
    await insertBacktestFills("run-1", fills as any);
    
    expect(mockSupabase.from).toHaveBeenCalledWith("backtest_fills");
    const payload = mockSupabase.insert.mock.calls[0][0];
    expect(payload[0].backtest_id).toBe("run-1");
  });

  test("insertBacktestResult: summarizes HTML 5xx error responses", async () => {
    jest.useFakeTimers();
    const htmlError = "<html><head><title>504 Gateway Time-out</title></head><body>Server Error</body></html>";
    mockSupabase.insert.mockResolvedValue({ error: { message: htmlError } });

    const result: any = {
      started_at: Date.now(),
      completed_at: Date.now(),
      equity_curve: []
    };

    const promise = insertBacktestResult(result);
    promise.catch(() => {}); // prevent unhandled-rejection before .rejects is attached
    // Advance through all retry delays (2s + 4s + 6s)
    await jest.runAllTimersAsync();
    await expect(promise).rejects.toThrow(/HTML response \(Cloudflare\/5xx\)/);
    expect(logger.error).toHaveBeenCalledWith(
      "insertBacktestResult failed",
      expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining("HTML response")
        })
      })
    );
    jest.useRealTimers();
  });
});
