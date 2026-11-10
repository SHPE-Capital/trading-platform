/**
 * Tests for filters/volume.ts (Skip high-volume moves; useVolume / volumeMaxRatio).
 * Owner: whoever owns the filter. Replace the first test once your rule exists,
 * and turn each it.todo into a real test with fake bars from ./helpers.
 */

import { volumeAllows } from '../../../strategies/team3Reversal/filters/volume';
import { entryInput, fakeBar, fakeHistory } from './helpers';

describe('volume filter', () => {
  it('lets every trade through until the rule is written (replace this test)', () => {
    const input = entryInput({ history: fakeHistory([100, 100.1, 99.9, 100]), bar: fakeBar(0, 101) });
    expect(volumeAllows(input)).toBe(true);
  });

  it.todo("blocks a bar whose volume is more than volumeMaxRatio times the recent average");
  it.todo("allows a bar with normal volume");
  it.todo("decides what to do when recent volume is zero (and says why)");
});
