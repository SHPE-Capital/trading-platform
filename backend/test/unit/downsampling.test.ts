
import { downsampleEquityCurve } from "../../src/adapters/supabase/repositories";

describe("downsampleEquityCurve", () => {
  test("Series of length <= 5000 returned unchanged", () => {
    const input = Array.from({ length: 100 }, (_, i) => ({ t: i, v: i }));
    const output = downsampleEquityCurve(input, 5000);
    expect(output).toHaveLength(100);
    expect(output).toEqual(input);
  });

  test("Series of length 50000 downsampled to 5000", () => {
    const input = Array.from({ length: 50000 }, (_, i) => ({ t: i, v: i }));
    const output = downsampleEquityCurve(input, 5000);
    expect(output).toHaveLength(5000);
  });

  test("First and last points exactly preserved", () => {
    const input = Array.from({ length: 10000 }, (_, i) => ({ t: i, v: i }));
    const output = downsampleEquityCurve(input, 500);
    expect(output[0]).toEqual(input[0]);
    expect(output[output.length - 1]).toEqual(input[input.length - 1]);
  });

  test("Points are time-ordered", () => {
    const input = Array.from({ length: 10000 }, (_, i) => ({ t: i, v: i }));
    const output = downsampleEquityCurve(input, 500);
    for (let i = 1; i < output.length; i++) {
      expect(output[i].t).toBeGreaterThan(output[i-1].t);
    }
  });
});
