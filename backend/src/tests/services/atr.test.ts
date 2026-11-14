import { WilderAtr } from '../../services/indicators/atr';

// Hand-worked series, period 3.
// bar: H L C            TR
// b0 : 10 8  9          (no prior close)
// b1 : 11 9  10         max(2, |11-9|=2, |9-9|=0)   = 2
// b2 : 13 10 12         max(3, |13-10|=3, |10-10|=0) = 3
// b3 : 12 9  10         max(3, |12-12|=0, |9-12|=3)  = 3
// b4 : 14 11 13         max(3, |14-10|=4, |11-10|=1) = 4
// ATR seed at b3 = (2+3+3)/3 = 8/3; b4 = (8/3*2 + 4)/3 = 28/9
const bars = [
  { high: 10, low: 8, close: 9 },
  { high: 11, low: 9, close: 10 },
  { high: 13, low: 10, close: 12 },
  { high: 12, low: 9, close: 10 },
  { high: 14, low: 11, close: 13 },
];

describe('WilderAtr', () => {
  it('is NaN until `period` true ranges exist, then seeds with their mean', () => {
    const atr = new WilderAtr(3);
    const out = bars.map((b) => atr.update(b));
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeNaN();
    expect(out[3]).toBeCloseTo(8 / 3, 10);
  });

  it('applies Wilder smoothing after the seed', () => {
    const atr = new WilderAtr(3);
    const out = bars.map((b) => atr.update(b));
    expect(out[4]).toBeCloseTo(28 / 9, 10);
    expect(atr.value).toBeCloseTo(28 / 9, 10);
  });

  it('uses the previous close across a gap (no session reset)', () => {
    const atr = new WilderAtr(1);
    atr.update({ high: 10, low: 9, close: 9.5 });
    // gap up: TR = max(1, |20-9.5|=10.5, |19-9.5|=9.5) = 10.5
    expect(atr.update({ high: 20, low: 19, close: 19.5 })).toBeCloseTo(10.5, 10);
  });

  it('with period 1 the ATR equals the latest true range', () => {
    const atr = new WilderAtr(1);
    atr.update(bars[0]);
    expect(atr.update(bars[1])).toBe(2);
    expect(atr.update(bars[2])).toBe(3);
  });

  it('rejects an invalid period and invalid bars', () => {
    expect(() => new WilderAtr(0)).toThrow(RangeError);
    expect(() => new WilderAtr(2.5)).toThrow(RangeError);
    const atr = new WilderAtr(3);
    expect(() => atr.update({ high: NaN, low: 1, close: 1 })).toThrow(RangeError);
    expect(() => atr.update({ high: 1, low: 2, close: 1 })).toThrow(RangeError);
  });
});
