/**
 * Tests for filters/timeOfDay.ts (Skip the open and close; useTimeOfDay / skipEdgeMinutes).
 * Owner: whoever owns the filter. Replace the first test once your rule exists,
 * and turn each it.todo into a real test with fake bars from ./helpers.
 */

import { timeOfDayAllows } from '../../../strategies/team3Reversal/filters/timeOfDay';
import { entryInput, fakeBar, fakeHistory } from './helpers';

describe('timeOfDay filter', () => {
  it('lets every trade through until the rule is written (replace this test)', () => {
    const input = entryInput({ history: fakeHistory([100, 100.1, 99.9, 100]), bar: fakeBar(0, 101) });
    expect(timeOfDayAllows(input)).toBe(true);
  });

  it.todo("blocks bars in the first skipEdgeMinutes minutes after 9:30 ET");
  it.todo("blocks bars in the last skipEdgeMinutes minutes before 16:00 ET");
  it.todo("allows a midday bar");
});
