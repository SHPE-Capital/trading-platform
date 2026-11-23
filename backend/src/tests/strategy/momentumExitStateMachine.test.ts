import {
  ExitStateMachine,
  ExitStateMachineRegistry,
  type ExitCommand,
  type ExitConfig,
  type ExitEvent,
} from "../../strategies/momentum/exitStateMachine";

const MIN = 60_000;
const T0 = 1_700_000_000_000;
const CLOSE = T0 + 300 * MIN;

const cfg: ExitConfig = {
  initialStopAtr: 1.5,
  trailActivationAtr: 1.0,
  trailDistanceAtr: 1.5,
  maxHoldMinutes: 60,
  sessionExitMinutesBeforeClose: 5,
  cancelConfirmTimeoutMs: 5_000,
  sellConfirmTimeoutMs: 10_000,
};

function make(id = "p1", sessionCloseTs = CLOSE) {
  return new ExitStateMachine({ positionId: id, symbol: "AAA", atrAtEntry: 2, sessionCloseTs, config: cfg });
}

let n = 0;
const eid = () => `e${++n}`;
type Ev<T extends ExitEvent["type"]> = Extract<ExitEvent, { type: T }>;
const ev = <T extends ExitEvent["type"]>(type: T, ts: number, rest: Omit<Ev<T>, "type" | "ts" | "eventId"> | Record<string, never> = {}) =>
  ({ type, ts, eventId: eid(), ...rest }) as ExitEvent;

/** Fill 100 @ 100, stop placed and acked at 97 (100 - 1.5*2). */
function protectedMachine(m = make()) {
  const id = m.positionId;
  const c1 = m.handle(ev("ENTRY_FILL", T0, { cumQty: 100, avgPrice: 100 }));
  expect(c1).toEqual([{ kind: "PLACE_STOP", clientOrderId: `${id}:stop:1`, symbol: "AAA", qty: 100, stopPrice: 97 }]);
  m.handle(ev("STOP_ACK", T0 + 1, { brokerOrderId: "s1", qty: 100, stopPrice: 97 }));
  m.handle(ev("ENTRY_DONE", T0 + 2));
  return m;
}

describe("ExitStateMachine", () => {
  it("places the initial stop 1.5 ATR below the fill, sized to filled qty", () => {
    const m = protectedMachine();
    expect(m.state).toBe("PROTECTED");
    expect(m.currentStopPrice).toBe(97);
  });

  it("resizes the stop after a partial fill, one replace in flight at a time", () => {
    const m = make();
    m.handle(ev("ENTRY_FILL", T0, { cumQty: 40, avgPrice: 100 }));
    // second partial arrives before the first stop is acked: no second command yet
    expect(m.handle(ev("ENTRY_FILL", T0 + 100, { cumQty: 100, avgPrice: 100 }))).toEqual([]);
    const next = m.handle(ev("STOP_ACK", T0 + 200, { brokerOrderId: "s1", qty: 40, stopPrice: 97 }));
    expect(next).toEqual([
      { kind: "REPLACE_STOP", brokerOrderId: "s1", clientOrderId: "p1:stop:2", symbol: "AAA", qty: 100, stopPrice: 97 },
    ]);
    expect(m.handle(ev("STOP_ACK", T0 + 300, { brokerOrderId: "s2", qty: 100, stopPrice: 97 }))).toEqual([]);
  });

  it("trails after a close >= entry + 1 ATR, never lowers, and ignores closes before the fill", () => {
    const m = protectedMachine();
    expect(m.handle(ev("BAR_CLOSE", T0 - 1, { close: 150 }))).toEqual([]); // before the fill
    expect(m.handle(ev("BAR_CLOSE", T0 + MIN, { close: 101.9 }))).toEqual([]); // below activation (102)
    const up = m.handle(ev("BAR_CLOSE", T0 + 2 * MIN, { close: 106 }));
    expect(up).toEqual([
      { kind: "REPLACE_STOP", brokerOrderId: "s1", clientOrderId: "p1:stop:2", symbol: "AAA", qty: 100, stopPrice: 103 },
    ]);
    m.handle(ev("STOP_ACK", T0 + 2 * MIN + 1, { brokerOrderId: "s2", qty: 100, stopPrice: 103 }));
    expect(m.handle(ev("BAR_CLOSE", T0 + 3 * MIN, { close: 104 }))).toEqual([]); // pullback: stop stays 103
    expect(m.currentStopPrice).toBe(103);
  });

  it("closes as trailing_stop when the trailed stop fills, without a sell", () => {
    const m = protectedMachine();
    m.handle(ev("BAR_CLOSE", T0 + MIN, { close: 106 }));
    m.handle(ev("STOP_ACK", T0 + MIN + 1, { brokerOrderId: "s2", qty: 100, stopPrice: 103 }));
    expect(m.handle(ev("STOP_FILLED", T0 + 2 * MIN, { qty: 100 }))).toEqual([]);
    expect(m.isFlat).toBe(true);
    expect(m.reason).toBe("trailing_stop");
  });

  it("closes as initial_stop when the first stop fills", () => {
    const m = protectedMachine();
    m.handle(ev("STOP_FILLED", T0 + MIN, { qty: 100 }));
    expect(m.reason).toBe("initial_stop");
    expect(m.isFlat).toBe(true);
  });

  it.each([
    ["time_exit", T0 + 60 * MIN],
    ["session_exit", CLOSE - 5 * MIN],
  ] as const)("%s cancels the stop, waits for confirmation, then sells once", (reason, ts) => {
    const m = protectedMachine();
    const cancel = m.handle(ev("CLOCK", ts));
    expect(cancel).toEqual([{ kind: "CANCEL_STOP", brokerOrderId: "s1", symbol: "AAA" }]);
    expect(m.state).toBe("CANCELING_STOP");
    // no sell until the cancel is confirmed, and further triggers add nothing
    expect(m.handle(ev("CLOCK", ts + 1000))).toEqual([]);
    expect(m.handle(ev("EMERGENCY", ts + 1000))).toEqual([]);
    const sell = m.handle(ev("STOP_CANCELED", ts + 1500));
    expect(sell).toEqual([{ kind: "MARKET_SELL", clientOrderId: "p1:exit:1", symbol: "AAA", qty: 100, reason }]);
    m.handle(ev("SELL_FILLED", ts + 2000, { qty: 100 }));
    expect(m.isFlat).toBe(true);
    expect(m.reason).toBe(reason);
  });

  it("early close uses the actual close for the session exit", () => {
    const early = T0 + 50 * MIN;
    const m = make("p1", early);
    m.handle(ev("ENTRY_FILL", T0, { cumQty: 10, avgPrice: 100 }));
    m.handle(ev("STOP_ACK", T0 + 1, { brokerOrderId: "s1", qty: 10, stopPrice: 97 }));
    expect(m.handle(ev("CLOCK", early - 5 * MIN - 1))).toEqual([]);
    const cmds = m.handle(ev("CLOCK", early - 5 * MIN));
    expect(cmds.map((c) => c.kind)).toEqual(["CANCEL_ENTRY", "CANCEL_STOP"]);
    expect(m.state).toBe("CANCELING_STOP");
  });

  it("emergency before any fill cancels the entry; a fill racing the cancel is still exited", () => {
    const m = make();
    expect(m.handle(ev("EMERGENCY", T0))).toEqual([{ kind: "CANCEL_ENTRY", symbol: "AAA" }]);
    expect(m.isFlat).toBe(false);
    const cmds = m.handle(ev("ENTRY_FILL", T0 + 10, { cumQty: 5, avgPrice: 100 }));
    expect(cmds).toEqual([{ kind: "MARKET_SELL", clientOrderId: "p1:exit:1", symbol: "AAA", qty: 5, reason: "emergency" }]);
  });

  it("emergency with an entry that never fills closes on ENTRY_DONE", () => {
    const m = make();
    m.handle(ev("EMERGENCY", T0));
    m.handle(ev("ENTRY_DONE", T0 + 5));
    expect(m.isFlat).toBe(true);
  });

  it("defers an exit requested while the stop placement is unacked", () => {
    const m = make();
    m.handle(ev("ENTRY_FILL", T0, { cumQty: 10, avgPrice: 100 }));
    expect(m.handle(ev("EMERGENCY", T0 + 5)).map((c) => c.kind)).toEqual(["CANCEL_ENTRY"]);
    expect(m.handle(ev("STOP_ACK", T0 + 10, { brokerOrderId: "s1", qty: 10, stopPrice: 97 }))).toEqual([
      { kind: "CANCEL_STOP", brokerOrderId: "s1", symbol: "AAA" },
    ]);
  });

  it("stop fills while it is being cancelled: no market sell", () => {
    const m = protectedMachine();
    m.handle(ev("EMERGENCY", T0 + MIN));
    expect(m.handle(ev("STOP_FILLED", T0 + MIN + 1, { qty: 100 }))).toEqual([]);
    expect(m.isFlat).toBe(true);
    expect(m.handle(ev("STOP_CANCELED", T0 + MIN + 2))).toEqual([]);
  });

  it("cancel rejected as already terminal reads the broker position instead of selling", () => {
    const m = protectedMachine();
    m.handle(ev("EMERGENCY", T0 + MIN));
    expect(m.handle(ev("CANCEL_REJECTED", T0 + MIN + 1, { alreadyTerminal: true }))).toEqual([{ kind: "READ_POSITION", symbol: "AAA" }]);
    expect(m.handle(ev("POSITION_READ", T0 + MIN + 2, { qty: 0 }))).toEqual([]);
    expect(m.isFlat).toBe(true);
  });

  it("cancel rejected as terminal with shares left sells the broker quantity", () => {
    const m = protectedMachine();
    m.handle(ev("EMERGENCY", T0 + MIN));
    m.handle(ev("CANCEL_REJECTED", T0 + MIN + 1, { alreadyTerminal: true }));
    const cmds = m.handle(ev("POSITION_READ", T0 + MIN + 2, { qty: 60 }));
    expect(cmds).toEqual([{ kind: "MARKET_SELL", clientOrderId: "p1:exit:1", symbol: "AAA", qty: 60, reason: "emergency" }]);
  });

  it("a held-qty sell rejection re-reads the position and retries once, then raises an exception", () => {
    const m = protectedMachine();
    m.handle(ev("EMERGENCY", T0 + MIN));
    m.handle(ev("STOP_CANCELED", T0 + MIN + 1));
    expect(m.handle(ev("SELL_REJECTED", T0 + MIN + 2, { reason: "held", heldQty: true }))).toEqual([{ kind: "READ_POSITION", symbol: "AAA" }]);
    const retry = m.handle(ev("POSITION_READ", T0 + MIN + 3, { qty: 100 }));
    expect(retry).toEqual([{ kind: "MARKET_SELL", clientOrderId: "p1:exit:2", symbol: "AAA", qty: 100, reason: "emergency" }]);
    m.handle(ev("SELL_REJECTED", T0 + MIN + 4, { reason: "held", heldQty: true }));
    expect(m.state).toBe("EXCEPTION");
    expect(m.isFlat).toBe(false);
    expect(m.exceptions).toHaveLength(1);
  });

  it("a halt during the exit is an exception, never flat", () => {
    const m = protectedMachine();
    m.handle(ev("EMERGENCY", T0 + MIN));
    m.handle(ev("STOP_CANCELED", T0 + MIN + 1));
    m.handle(ev("HALTED", T0 + MIN + 2));
    expect(m.state).toBe("EXCEPTION");
    expect(m.isFlat).toBe(false);
    expect(m.exceptions[0].reason).toMatch(/halted/);
  });

  it("an unconfirmed cancel or sell times out into an exception", () => {
    const a = protectedMachine();
    a.handle(ev("EMERGENCY", T0 + MIN));
    a.handle(ev("CLOCK", T0 + MIN + 4_999));
    expect(a.state).toBe("CANCELING_STOP");
    a.handle(ev("CLOCK", T0 + MIN + 5_000));
    expect(a.state).toBe("EXCEPTION");

    const b = protectedMachine(make("p2"));
    b.handle(ev("EMERGENCY", T0 + MIN));
    b.handle(ev("STOP_CANCELED", T0 + MIN + 1));
    b.handle(ev("CLOCK", T0 + MIN + 1 + 10_000));
    expect(b.state).toBe("EXCEPTION");
  });

  it("a rejected stop is recorded as an exception and the time exit sells without a cancel", () => {
    const m = make();
    m.handle(ev("ENTRY_FILL", T0, { cumQty: 10, avgPrice: 100 }));
    m.handle(ev("STOP_REJECTED", T0 + 1, { reason: "403" }));
    expect(m.exceptions).toHaveLength(1);
    expect(m.state).toBe("PROTECTED");
    const cmds = m.handle(ev("CLOCK", T0 + 60 * MIN));
    expect(cmds.filter((c) => c.kind === "MARKET_SELL")).toEqual([
      { kind: "MARKET_SELL", clientOrderId: "p1:exit:1", symbol: "AAA", qty: 10, reason: "time_exit" },
    ]);
  });

  it("replaying the same events produces no second order", () => {
    const m = protectedMachine();
    const emergency = ev("EMERGENCY", T0 + MIN);
    const canceled = ev("STOP_CANCELED", T0 + MIN + 1);
    expect(m.handle(emergency)).toHaveLength(1);
    expect(m.handle(canceled)).toHaveLength(1);
    expect(m.handle(emergency)).toEqual([]);
    expect(m.handle(canceled)).toEqual([]);
    const fill = ev("SELL_FILLED", T0 + MIN + 2, { qty: 100 });
    m.handle(fill);
    expect(m.handle(fill)).toEqual([]);
    expect(m.handle(ev("EMERGENCY", T0 + MIN + 3))).toEqual([]);
  });

  it("rejects a non-positive ATR", () => {
    expect(() => new ExitStateMachine({ positionId: "x", symbol: "A", atrAtEntry: 0, sessionCloseTs: CLOSE, config: cfg })).toThrow();
  });
});

describe("ExitStateMachineRegistry", () => {
  it("liquidateAll requests an exit per open position and is idempotent per request id", () => {
    const reg = new ExitStateMachineRegistry();
    const a = protectedMachine(make("a"));
    const b = make("b");
    reg.add(a);
    reg.add(b);
    const first = reg.liquidateAll("halt-1", T0 + MIN);
    const kinds = (c: ExitCommand[]) => c.map((x) => x.kind);
    expect(kinds(first[0].commands)).toEqual(["CANCEL_STOP"]);
    expect(kinds(first[1].commands)).toEqual(["CANCEL_ENTRY"]);
    expect(reg.liquidateAll("halt-1", T0 + MIN).every((r) => r.commands.length === 0)).toBe(true);
  });
});
