/**
 * tests/bench/charts.test.ts
 *
 * Report charts: well-formed SVG, legend + direct labels, at most three
 * categorical series, percentiles below their sample minimum not drawn, and
 * text escaped.
 */

import { delayCurveSvg, latencyPercentilesSvg } from "../../bench/charts";

const points = (base: number) => [0, 10, 100].map((d, i) => ({ delayMs: d, netPnl: base - i, roundTrips: 40 }));

describe("delayCurveSvg", () => {
  it("draws one line per scenario (max three) with a legend and end labels", () => {
    const svg = delayCurveSvg("Net P&L <test>", new Map([["base", points(5)], ["stress", points(-3)], ["x", points(1)], ["fourth", points(2)]]));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Net P&amp;L &lt;test&gt;");
    expect((svg.match(/<polyline /g) ?? []).length).toBe(3);
    expect(svg).not.toContain(">fourth<");
    expect(svg).toContain("−$"); // negative axis labels
    expect((svg.match(/<title>/g) ?? []).length).toBe(9); // a hover tooltip per point
  });
});

describe("latencyPercentilesSvg", () => {
  it("draws only the percentiles that met their sample minimum", () => {
    const svg = latencyPercentilesSvg("Latency", [
      { label: "Receive-to-submit", count: 500, p50: 0.03, p95: 0.08, p99: null },
      { label: "Frame parse", count: 5_000, p50: 0.002, p95: 0.006, p99: 0.011 },
    ]);
    expect((svg.match(/<circle class="s\d ring"/g) ?? []).length).toBe(5);
    expect(svg).toContain("Receive-to-submit p95: 80.0 µs (n=500)");
    expect(svg).toContain(">p99<"); // legend
  });
});
