import { DailyHalt } from '../../strategies/momentum/dailyHalt';
import { ExitStateMachine, ExitStateMachineRegistry, type ExitConfig } from '../../strategies/momentum/exitStateMachine';

const T0 = 1_700_000_000_000;
const cfg: ExitConfig = {
  initialStopAtr: 1.5, trailActivationAtr: 1, trailDistanceAtr: 1.5, maxHoldMinutes: 60,
  sessionExitMinutesBeforeClose: 5, cancelConfirmTimeoutMs: 5000, sellConfirmTimeoutMs: 10000,
};
const noop = () => undefined;

function openPosition(reg: ExitStateMachineRegistry, id: string) {
  const m = new ExitStateMachine({ positionId: id, symbol: id.toUpperCase(), atrAtEntry: 2, sessionCloseTs: T0 + 6 * 3_600_000, config: cfg });
  m.handle({ type: 'ENTRY_FILL', eventId: `${id}-f`, ts: T0, cumQty: 10, avgPrice: 100 });
  m.handle({ type: 'STOP_ACK', eventId: `${id}-a`, ts: T0 + 1, brokerOrderId: `${id}-s`, qty: 10, stopPrice: 97 });
  m.handle({ type: 'ENTRY_DONE', eventId: `${id}-d`, ts: T0 + 2 });
  reg.add(m);
  return m;
}

describe('DailyHalt', () => {
  it('does nothing above the threshold', () => {
    const reg = new ExitStateMachineRegistry();
    const calls: string[] = [];
    const h = new DailyHalt({ haltPct: 0.01, startEquity: 100_000 }, { registry: reg, cancelPendingEntries: () => calls.push('cancel') });
    expect(h.onEquity(99_001, T0)).toBeNull();
    expect(h.isHalted()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('on a 1% fall: halts entries, cancels pending entries, then requests liquidation, once', () => {
    const reg = new ExitStateMachineRegistry();
    openPosition(reg, 'aaa');
    openPosition(reg, 'bbb');
    const order: string[] = [];
    const h = new DailyHalt(
      { haltPct: 0.01, startEquity: 100_000 },
      {
        registry: reg,
        cancelPendingEntries: () => order.push(h.isHalted() ? 'cancel(after-halt)' : 'cancel(before-halt)'),
      },
    );
    const trip = h.onEquity(99_000, T0 + 10)!;
    expect(trip.fallPct).toBeCloseTo(0.01, 10);
    expect(order).toEqual(['cancel(after-halt)']);
    expect(trip.liquidations.map((l) => [l.positionId, l.commands.map((c) => c.kind)])).toEqual([
      ['aaa', ['CANCEL_STOP']],
      ['bbb', ['CANCEL_STOP']],
    ]);
    expect(reg.get('aaa')!.state).toBe('CANCELING_STOP');
    // latched: a second breach and a replay produce nothing new
    expect(h.onEquity(98_000, T0 + 20)).toBeNull();
    expect(order).toHaveLength(1);
  });

  it('ignores non-finite equity and rejects bad config', () => {
    const reg = new ExitStateMachineRegistry();
    const h = new DailyHalt({ haltPct: 0.01, startEquity: 100_000 }, { registry: reg, cancelPendingEntries: noop });
    expect(h.onEquity(Number.NaN, T0)).toBeNull();
    expect(h.isHalted()).toBe(false);
    expect(() => new DailyHalt({ haltPct: 0, startEquity: 1 }, { registry: reg, cancelPendingEntries: noop })).toThrow();
    expect(() => new DailyHalt({ haltPct: 0.01, startEquity: 0 }, { registry: reg, cancelPendingEntries: noop })).toThrow();
  });
});
