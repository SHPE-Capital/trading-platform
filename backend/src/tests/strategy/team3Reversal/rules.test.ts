import { entryIdea, exitReason, sessionWindow } from '../../../strategies/team3Reversal/rules';
import { createTeam3ReversalConfig } from '../../../strategies/team3Reversal/team3ReversalConfig';
import { MINUTE, OPEN_ET, fakeBar, fakeVwap } from './helpers';

const c = createTeam3ReversalConfig({ id: 'rules' });   // entryZ 2, stopZ 3.5, minEdgeBps 15, maxHoldBars 30
const at = (minute: number) => OPEN_ET + minute * MINUTE;

describe('sessionWindow (skip 15 at the open, no entries last 15, flatten last 5)', () => {
  it.each([
    [0, 'warmup'], [14, 'warmup'], [15, 'open'], [374, 'open'],
    [375, 'no_entries'], [384, 'no_entries'], [385, 'flatten'], [389, 'flatten'],
  ])('minute %i after 9:30 is %s', (minute, expected) => {
    expect(sessionWindow(at(minute), c)).toBe(expected);
  });
});

describe('entryIdea: fade a bar stretched from VWAP, if the edge beats costs', () => {
  const prev = fakeBar(-1, 100);
  it('sells an up bar that closes >= entryZ above VWAP', () => {
    expect(entryIdea(fakeBar(0, 101), prev, fakeVwap({ vwap: 100, z: 2.5 }), c)).toMatchObject({ side: 'sell', z: 2.5 });
  });
  it('buys a down bar that closes >= entryZ below VWAP', () => {
    expect(entryIdea(fakeBar(0, 99), prev, fakeVwap({ vwap: 100, z: -2.5 }), c)).toMatchObject({ side: 'buy' });
  });
  it('skips when the move points away from the stretch (up bar but below VWAP)', () => {
    expect(entryIdea(fakeBar(0, 101), prev, fakeVwap({ vwap: 102, z: -2.5 }), c)).toBeNull();
  });
  it('skips when z is below entryZ', () => {
    expect(entryIdea(fakeBar(0, 101), prev, fakeVwap({ vwap: 100, z: 1.9 }), c)).toBeNull();
  });
  it('skips an entry already at or past its own stop (M1: it would be stopped on the next bar)', () => {
    expect(entryIdea(fakeBar(0, 101), prev, fakeVwap({ vwap: 100, z: 3.5 }), c)).toBeNull();
    expect(entryIdea(fakeBar(0, 99), prev, fakeVwap({ vwap: 100, z: -9.6 }), c)).toBeNull();
    expect(entryIdea(fakeBar(0, 101), prev, fakeVwap({ vwap: 100, z: 3.4 }), c)).not.toBeNull();
  });
  it('skips when the edge back to VWAP is under minEdgeBps', () => {
    expect(entryIdea(fakeBar(0, 100.1), prev, fakeVwap({ vwap: 100, z: 3 }), c)).toBeNull();   // 10 bps
  });
  it('skips without VWAP, without sigma, or on a flat bar', () => {
    expect(entryIdea(fakeBar(0, 101), prev, null, c)).toBeNull();
    expect(entryIdea(fakeBar(0, 101), prev, fakeVwap({ z: null }), c)).toBeNull();
    expect(entryIdea(fakeBar(0, 100), prev, fakeVwap({ z: 3 }), c)).toBeNull();
  });
});

describe('exitReason: the first reason that applies wins', () => {
  const short = { qty: -10, barsHeld: 1, fromEarlierDay: false };
  it.each([
    ['stale beats everything', { ...short, fromEarlierDay: true }, 'flatten', 0, 'stale'],
    ['close in the flatten window', short, 'flatten', 5, 'close'],
    ['stop when a short stretches further up', short, 'open', 3.5, 'stop'],
    ['target when a short is back at VWAP', short, 'open', 0, 'target'],
    ['time after maxHoldBars', { ...short, barsHeld: 30 }, 'open', 1, 'time'],
    ['hold otherwise', short, 'open', 1, null],
    ['long: stop below', { ...short, qty: 10 }, 'open', -3.5, 'stop'],
    ['long: target at VWAP', { ...short, qty: 10 }, 'open', 0.1, 'target'],
    ['no z: only stale/close/time apply', short, 'no_entries', null, null],
  ] as const)('%s', (_name, holding, window, z, expected) => {
    expect(exitReason(holding, window, z, c)).toBe(expected);
  });
});
