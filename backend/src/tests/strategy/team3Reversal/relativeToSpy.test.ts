/**
 * Tests for filters/relativeToSpy.ts (Relative to the market; useRelativeToSpy / benchmarkSymbol).
 * Cases by Alex Rivera (PR #78), run against the specced rule; more in relativeToSpyShare.test.ts.
 */

import { relativeToSpyAllows } from '../../../strategies/team3Reversal/filters/relativeToSpy';
import { entryInput, fakeBar, fakeHistory } from './helpers';

describe('relativeToSpy filter', () => {
  it.each([
    [101, [fakeBar(-1, 100), fakeBar(0, 101)], false],
    // Rivera's boundary case: share exactly 0.5. His rule (> 2x) blocked it; the spec's >= cutoff (0.5 default) allows it.
    [102, [fakeBar(-1, 100), fakeBar(0, 101)], true],
    [97, [fakeBar(-1, 100), fakeBar(0, 99), fakeBar(1, 110)], true],
    [103, [fakeBar(-1, 100), fakeBar(0, 101)], true],
    [103, [fakeBar(-2, 100), fakeBar(-1, 100)], false],
    [103, [fakeBar(-2, 100), fakeBar(0, 100)], false],
  ])('with stock close %s and benchmark bars %j, allows entry: %s', (close, benchmarkBars, expected) => {
    const input = entryInput({
      history: fakeHistory([100]),
      bar: fakeBar(0, close),
      others: { SPY: benchmarkBars },
    });
    expect(relativeToSpyAllows(input)).toBe(expected);
  });
});
