import { exitReason, partwayReached } from '../../../strategies/team3Reversal/rules';
import { createTeam3ReversalConfig, validateTeam3ReversalConfig } from '../../../strategies/team3Reversal/team3ReversalConfig';

const off = createTeam3ReversalConfig({ id: 'pw-off' });
const on = createTeam3ReversalConfig({ id: 'pw-on', usePartwayTarget: true, tpFraction: 0.5 });
const short = { qty: -10, barsHeld: 3, fromEarlierDay: false, entryZ: 2.4 };
const long = { qty: 10, barsHeld: 3, fromEarlierDay: false, entryZ: -2.4 };

describe('R4 partway target', () => {
  it('is off by default: the baseline exits are unchanged', () => {
    expect(off.usePartwayTarget).toBe(false);
    expect(exitReason(short, 'open', 1.0, off)).toBeNull();
    expect(exitReason(long, 'open', -1.0, off)).toBeNull();
  });
  it('short exits once z <= (1 - f) * z0', () => {
    expect(exitReason(short, 'open', 1.3, on)).toBeNull();
    expect(exitReason(short, 'open', 1.2, on)).toBe('partway');
  });
  it('long exits once z >= (1 - f) * z0', () => {
    expect(exitReason(long, 'open', -1.3, on)).toBeNull();
    expect(exitReason(long, 'open', -1.2, on)).toBe('partway');
  });
  it('the VWAP target and the stop still apply, and win over partway', () => {
    expect(exitReason(short, 'open', -0.1, on)).toBe('target');
    expect(exitReason(short, 'open', 3.6, on)).toBe('stop');
    expect(exitReason({ ...short, barsHeld: 30 }, 'open', 2.0, on)).toBe('time');
  });
  it('does nothing without an entry z', () => {
    expect(exitReason({ ...short, entryZ: null }, 'open', 0.5, on)).toBeNull();
  });
  it('partwayReached at f = 1 is the VWAP target', () => {
    expect(partwayReached(true, 0, 2, 1)).toBe(true);
    expect(partwayReached(true, 0.01, 2, 1)).toBe(false);
  });
  it('validates tpFraction in (0, 1]', () => {
    expect(() => validateTeam3ReversalConfig({ ...on, tpFraction: 0 })).toThrow(/tpFraction/);
    expect(() => validateTeam3ReversalConfig({ ...on, tpFraction: 1.2 })).toThrow(/tpFraction/);
  });
});
