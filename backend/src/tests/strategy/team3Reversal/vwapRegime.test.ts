import { vwapRegimeAllows } from '../../../strategies/team3Reversal/filters/vwapRegime';
import { entryInput, fakeBar, fakeHistory, fakeVwap } from './helpers';

const base = { history: fakeHistory([100, 100]), bar: fakeBar(0, 101) };

describe('vwapRegime: fade only on choppy (rotational) days', () => {
  it('blocks when there is no VWAP yet', () => {
    expect(vwapRegimeAllows(entryInput({ ...base, vwap: null }))).toBe(false);
  });
  it('blocks a trend day (few crossings)', () => {
    expect(vwapRegimeAllows(entryInput({ ...base, vwap: fakeVwap({ crossings: 1 }), config: { minVwapCrossings: 4 } }))).toBe(false);
  });
  it('allows a choppy day (enough crossings)', () => {
    expect(vwapRegimeAllows(entryInput({ ...base, vwap: fakeVwap({ crossings: 4 }), config: { minVwapCrossings: 4 } }))).toBe(true);
  });
});
