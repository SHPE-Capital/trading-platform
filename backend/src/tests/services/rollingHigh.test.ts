import { RollingHigh } from '../../services/indicators/rollingHigh';

describe('RollingHigh', () => {
  it('returns the max of the PRECEDING n highs and excludes the current bar', () => {
    const rh = new RollingHigh(3);
    // highs: 5 7 6 9 8 4 10
    const out = [5, 7, 6, 9, 8, 4, 10].map((h) => rh.update(h));
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeNaN();
    expect(out[3]).toBe(7); // max(5,7,6); the 9 on this bar is not included
    expect(out[4]).toBe(9); // max(7,6,9)
    expect(out[5]).toBe(9); // max(6,9,8)
    expect(out[6]).toBe(9); // max(9,8,4); the 10 on this bar is not included
  });

  it('a bar that makes a new high is not compared with itself', () => {
    const rh = new RollingHigh(2);
    rh.update(1);
    rh.update(2);
    expect(rh.update(100)).toBe(2);
    expect(rh.update(3)).toBe(100);
  });

  it('forgets highs older than n bars', () => {
    const rh = new RollingHigh(2);
    [50, 1, 2].forEach((h) => rh.update(h));
    expect(rh.update(0)).toBe(2); // window is (1, 2): the 50 has rolled off
  });

  it('works with n = 1', () => {
    const rh = new RollingHigh(1);
    expect(rh.update(4)).toBeNaN();
    expect(rh.update(3)).toBe(4);
    expect(rh.update(9)).toBe(3);
  });

  it('rejects an invalid n and non-finite highs', () => {
    expect(() => new RollingHigh(0)).toThrow(RangeError);
    expect(() => new RollingHigh(2).update(NaN)).toThrow(RangeError);
  });
});
