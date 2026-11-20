import { timeOfDayAllows } from '../../../strategies/team3Reversal/filters/timeOfDay';
import { entryInput, fakeBar, fakeHistory, OPEN_ET } from './helpers';

describe('timeOfDay filter', () => {
  it.each([
    [0, 15, false],
    [14, 15, false],
    [15, 15, true],
    [150, 15, true],
    [374, 15, true],
    [375, 15, false],
    [389, 15, false],
    [0, 0, true],
    [389, 0, true],
  ])('at minute %i with %i edge minutes returns %s', (minute, skipEdgeMinutes, expected) => {
    const bar = fakeBar(minute, 101, 1_000, OPEN_ET);
    const history = fakeHistory([100], 1_000, bar.ts);
    expect(timeOfDayAllows(entryInput({ bar, history, config: { skipEdgeMinutes } }))).toBe(expected);
  });
});
