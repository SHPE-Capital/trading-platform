/**
 * Tests for filters/holdUntilBack.ts (Hold until it comes back; useHoldUntilBack / holdMaxBars).
 * Owner: whoever owns the rule. Replace the first test once your rule exists,
 * and turn each it.todo into a real test with fake bars from ./helpers.
 */

import { holdUntilBackShouldExit } from '../../../strategies/team3Reversal/filters/holdUntilBack';
import { exitInput, fakeBar, fakeHistory } from './helpers';

describe('holdUntilBack exit rule', () => {
  it('closes on the very next bar until the rule is written (replace this test)', () => {
    const input = exitInput({
      history: fakeHistory([100, 100, 101]), bar: fakeBar(0, 100.8), entryPrice: 101, barsHeld: 1,
    });
    expect(holdUntilBackShouldExit(input)).toBe(true);
  });

  it.todo("keeps a short open while the price is still above its recent average");
  it.todo("closes a short once the price is back at its recent average");
  it.todo("always closes after holdMaxBars bars");
});
