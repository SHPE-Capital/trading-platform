/**
 * Tests for filters/relativeToSpy.ts (Relative to the market; useRelativeToSpy / benchmarkSymbol).
 * Owner: whoever owns the filter. Replace the first test once your rule exists,
 * and turn each it.todo into a real test with fake bars from ./helpers.
 */

import { relativeToSpyAllows } from '../../../strategies/team3Reversal/filters/relativeToSpy';
import { entryInput, fakeBar, fakeHistory } from './helpers';

describe('relativeToSpy filter', () => {
  it('lets every trade through until the rule is written (replace this test)', () => {
    const input = entryInput({ history: fakeHistory([100, 100.1, 99.9, 100]), bar: fakeBar(0, 101) });
    expect(relativeToSpyAllows(input)).toBe(true);
  });

  it.todo("blocks a move that SPY made too over the same minute");
  it.todo("allows a move much bigger than SPY's over the same minute");
  it.todo("decides what to do when SPY's bar for this minute has not arrived (and says why)");
});
