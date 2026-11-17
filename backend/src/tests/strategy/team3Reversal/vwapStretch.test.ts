import { vwapStretchAllows } from '../../../strategies/team3Reversal/filters/vwapStretch';
import { entryInput, fakeBar, fakeHistory, fakeVwap } from './helpers';

const up = { history: fakeHistory([100, 100]), bar: fakeBar(0, 101) }; // baseline wants to sell
const down = { history: fakeHistory([100, 100]), bar: fakeBar(0, 99) }; // baseline wants to buy
const cfg = { minVwapZ: 1.5 };

describe('vwapStretch: fade only back toward VWAP from far away', () => {
  it('blocks without a z-score', () => {
    expect(vwapStretchAllows(entryInput({ ...up, vwap: fakeVwap({ z: null }), config: cfg }))).toBe(false);
    expect(vwapStretchAllows(entryInput({ ...up, vwap: null, config: cfg }))).toBe(false);
  });
  it('allows a sell when price is far above VWAP', () => {
    expect(vwapStretchAllows(entryInput({ ...up, vwap: fakeVwap({ z: 2 }), config: cfg }))).toBe(true);
  });
  it('blocks a sell when price is near or below VWAP', () => {
    expect(vwapStretchAllows(entryInput({ ...up, vwap: fakeVwap({ z: 1 }), config: cfg }))).toBe(false);
    expect(vwapStretchAllows(entryInput({ ...up, vwap: fakeVwap({ z: -2 }), config: cfg }))).toBe(false);
  });
  it('allows a buy only when price is far below VWAP', () => {
    expect(vwapStretchAllows(entryInput({ ...down, vwap: fakeVwap({ z: -2 }), config: cfg }))).toBe(true);
    expect(vwapStretchAllows(entryInput({ ...down, vwap: fakeVwap({ z: 2 }), config: cfg }))).toBe(false);
  });
});
