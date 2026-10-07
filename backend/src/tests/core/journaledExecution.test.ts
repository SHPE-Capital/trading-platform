import { JournaledExecutionSink, JournalUnavailableError, type OrderJournal } from "../../core/execution/journaledExecution";
import type { IExecutionSink } from "../../core/execution/IExecutionSink";
import type { OrderIntent } from "../../types/orders";

const intent = { id: "i-1", strategyId: "s", symbol: "F", side: "buy", qty: 1, orderType: "market", timeInForce: "day", ts: 1 } as OrderIntent;

function parts(journalOk = true, sendOk = true) {
  const calls: string[] = [];
  const journal: OrderJournal = {
    recordPending: jest.fn(async () => {
      calls.push("journal");
      if (!journalOk) throw new Error("db down");
    }),
    recordSendFailed: jest.fn(async () => { calls.push("failed"); }),
  };
  const inner: IExecutionSink = {
    submitOrder: jest.fn(async () => {
      calls.push("send");
      if (!sendOk) throw new Error("broker 422");
      return { id: "i-1" } as never;
    }),
    cancelOrder: jest.fn(async () => {}),
  };
  return { calls, journal, inner };
}

describe("JournaledExecutionSink", () => {
  it("writes the order to the ledger before sending it", async () => {
    const { calls, journal, inner } = parts();
    await new JournaledExecutionSink(inner, journal).submitOrder(intent);
    expect(calls).toEqual(["journal", "send"]);
  });

  it("fails closed: no ledger row, no order", async () => {
    const { journal, inner } = parts(false);
    const onFailure = jest.fn();
    await expect(new JournaledExecutionSink(inner, journal, onFailure).submitOrder(intent)).rejects.toBeInstanceOf(JournalUnavailableError);
    expect(inner.submitOrder).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(intent, expect.any(JournalUnavailableError));
  });

  it("marks the journaled row when the broker refuses the order", async () => {
    const { calls, journal, inner } = parts(true, false);
    await expect(new JournaledExecutionSink(inner, journal).submitOrder(intent)).rejects.toThrow("broker 422");
    expect(calls).toEqual(["journal", "send", "failed"]);
    expect(journal.recordSendFailed).toHaveBeenCalledWith("i-1", "broker 422");
  });
});
