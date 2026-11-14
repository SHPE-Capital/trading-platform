import { SessionVwap } from '../../services/indicators/sessionVwap';

describe('SessionVwap', () => {
  it('accumulates typical-price VWAP within a session', () => {
    const v = new SessionVwap();
    // typical = (10+8+9)/3 = 9, V=100 -> VWAP 9
    expect(v.update('d1', { high: 10, low: 8, close: 9, volume: 100 })).toBeCloseTo(9, 10);
    // typical = (12+10+11)/3 = 11, V=200 -> (900 + 2200) / 300 = 31/3
    expect(v.update('d1', { high: 12, low: 10, close: 11, volume: 200 })).toBeCloseTo(31 / 3, 10);
  });

  it('resets at the start of a new session', () => {
    const v = new SessionVwap();
    v.update('d1', { high: 10, low: 8, close: 9, volume: 100 });
    v.update('d1', { high: 12, low: 10, close: 11, volume: 200 });
    // new session: typical = (20+18+19)/3 = 19, nothing carried over
    expect(v.update('d2', { high: 20, low: 18, close: 19, volume: 50 })).toBeCloseTo(19, 10);
    // typical = (22+20+21)/3 = 21, V=50 -> (950 + 1050) / 100 = 20
    expect(v.update('d2', { high: 22, low: 20, close: 21, volume: 50 })).toBeCloseTo(20, 10);
  });

  it('is NaN while cumulative volume is zero, then valid', () => {
    const v = new SessionVwap();
    expect(v.update('d1', { high: 10, low: 8, close: 9, volume: 0 })).toBeNaN();
    expect(v.update('d1', { high: 12, low: 10, close: 11, volume: 100 })).toBeCloseTo(11, 10);
  });

  it('weights typical price by volume', () => {
    const v = new SessionVwap();
    v.update('d1', { high: 3, low: 3, close: 3, volume: 1 });
    // (3*1 + 9*3) / 4 = 7.5
    expect(v.update('d1', { high: 9, low: 9, close: 9, volume: 3 })).toBeCloseTo(7.5, 10);
  });

  it('rejects negative or non-finite volume and invalid bars', () => {
    const v = new SessionVwap();
    expect(() => v.update('d1', { high: 2, low: 1, close: 1, volume: -1 })).toThrow(RangeError);
    expect(() => v.update('d1', { high: 2, low: 1, close: 1, volume: NaN })).toThrow(RangeError);
    expect(() => v.update('d1', { high: 1, low: 2, close: 1, volume: 1 })).toThrow(RangeError);
  });
});
