import { conditionIdea, spyDivergenceIdea, type ConditionFeatures } from '../../../strategies/team3Reversal/rules';
import { createTeam3ReversalConfig, validateTeam3ReversalConfig } from '../../../strategies/team3Reversal/team3ReversalConfig';
import { fakeBar, fakeVwap } from './helpers';

const prev = fakeBar(-1, 100), bar = fakeBar(0, 101);
const feat = (over: Partial<ConditionFeatures> = {}): ConditionFeatures => ({
  ownShare: 0.9, absZ: 2, edgeBps: 50, crossings60: 1, volRatio: 1, rangeSigma: 0.2, trendBps: 30, timeOfDay: 1, spyZ: -1.5, turnBar: 0, ...over,
});
const cfg = (over: object) => createTeam3ReversalConfig({ id: 'ce', useConditionEntry: true, ...over });

describe('conditionIdea (F3-F5): opportunity set AND (lo, hi] ranges, SPY side, turn bar', () => {
  it('no conditions = the whole opportunity set (1.5 <= |z| < stopZ), side from z', () => {
    expect(conditionIdea(bar, prev, fakeVwap({ z: 2 }), feat(), cfg({}))?.side).toBe('sell');
    expect(conditionIdea(bar, prev, fakeVwap({ z: -1.6 }), feat(), cfg({}))?.side).toBe('buy');
    expect(conditionIdea(bar, prev, fakeVwap({ z: 1.4 }), feat(), cfg({}))).toBeNull();
  });
  it('ranges are (lo, hi]: lo excluded, hi included, null unbounded', () => {
    const c = cfg({ ceRanges: { ownShare: [0.945, null], trendBps: [null, 47.1] } });
    expect(conditionIdea(bar, prev, fakeVwap({ z: 2 }), feat({ ownShare: 0.95, trendBps: 47.1 }), c)).not.toBeNull();
    expect(conditionIdea(bar, prev, fakeVwap({ z: 2 }), feat({ ownShare: 0.945, trendBps: 10 }), c)).toBeNull();
    expect(conditionIdea(bar, prev, fakeVwap({ z: 2 }), feat({ ownShare: 0.99, trendBps: 47.2 }), c)).toBeNull();
    expect(conditionIdea(bar, prev, fakeVwap({ z: 2 }), feat({ ownShare: NaN }), c)).toBeNull();
  });
  it('SPY side and turn bar', () => {
    expect(conditionIdea(bar, prev, fakeVwap({ z: 2 }), feat({ spyZ: -1.2 }), cfg({ ceSpySide: 'opposite' }))).not.toBeNull();
    expect(conditionIdea(bar, prev, fakeVwap({ z: 2 }), feat({ spyZ: 1.2 }), cfg({ ceSpySide: 'opposite' }))).toBeNull();
    expect(conditionIdea(bar, prev, fakeVwap({ z: 2 }), feat({ spyZ: 0.5 }), cfg({ ceSpySide: 'neutral' }))).not.toBeNull();
    expect(conditionIdea(bar, prev, fakeVwap({ z: 2 }), feat({ turnBar: 1 }), cfg({ ceTurnBar: 0 }))).toBeNull();
  });
  it('F1 expressed as conditions gives the same entries as spyDivergenceIdea', () => {
    const f1 = cfg({ ceRanges: { crossings60: [0, 2] }, ceSpySide: 'opposite' });   // crossings in 1-2 = (0, 2]
    const div = createTeam3ReversalConfig({ id: 'div', useSpyDivergence: true });
    for (const z of [-3, -2, -1.6, -1.4, 1.4, 1.6, 2.5, 3.6]) for (const cr of [0, 1, 2, 3]) for (const sz of [-2, -0.5, 0.5, 2]) {
      const a = conditionIdea(bar, prev, fakeVwap({ z, crossings: cr }), feat({ crossings60: cr, spyZ: sz }), f1);
      const b = spyDivergenceIdea(bar, prev, fakeVwap({ z, crossings: cr }), fakeVwap({ z: sz }), div);
      expect(a?.side ?? null).toBe(b?.side ?? null);
    }
  });
  it('validation: one entry mode, known features only', () => {
    expect(() => validateTeam3ReversalConfig(cfg({ useSpyDivergence: true }))).toThrow(/one entry mode/);
    expect(() => validateTeam3ReversalConfig(cfg({ ceRanges: { foo: [0, 1] } }))).toThrow(/unknown feature/);
  });
});
