/**
 * Tests for filters/bigMove.ts (Big moves only; useBigMove / bigMoveMinZ).
 * Owner: whoever owns the filter. Replace the first test once your rule exists,
 * and turn each it.todo into a real test with fake bars from ./helpers.
 */

import { bigMoveAllows } from '../../../strategies/team3Reversal/filters/bigMove';
import { entryInput, fakeBar, fakeHistory } from './helpers';

describe('bigMove filter', () => {
  it('lets every trade through until the rule is written (replace this test)', () => {
    const input = entryInput({ history: fakeHistory([100, 100.1, 99.9, 100]), bar: fakeBar(0, 101) });
    expect(bigMoveAllows(input)).toBe(true);
  });

  it.todo("blocks a move smaller than bigMoveMinZ standard deviations of recent moves");
  it.todo("allows a move larger than bigMoveMinZ standard deviations");
  it.todo("decides what to do when history is too short to measure normal (and says why)");
});
