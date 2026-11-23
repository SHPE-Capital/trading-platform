/**
 * bench/charts.ts
 *
 * Static SVG charts for decision-report.md (written to <run>/plots/):
 *
 *   delay-curve.svg          net P&L (flattened) vs injected delay, one line per
 *                            cost scenario — the economic question in one view
 *   latency-percentiles.svg  p50 / p95 / p99 per stage on a log time axis
 *
 * Plain SVG so they render in any Markdown viewer; each point carries a
 * <title> (native hover tooltip) and every chart has a legend plus direct
 * labels, so identity is never color alone. Colors are the validated reference
 * categorical slots 1–3 (all-pairs safe in light and dark); text uses ink
 * tokens; dark mode follows the viewer's OS via an embedded media query.
 *
 * Inputs:  delay-cost result rows; latency summary rows.
 * Outputs: SVG strings.
 */

const W = 720;
const PAD = { top: 44, right: 150, bottom: 48, left: 72 };

const STYLE = `<style>
  .surface { fill: #fcfcfb; }
  .ink { fill: #0b0b0b; font: 13px system-ui, sans-serif; }
  .ink2 { fill: #52514e; font: 12px system-ui, sans-serif; }
  .title { fill: #0b0b0b; font: 600 15px system-ui, sans-serif; }
  .grid { stroke: #e4e3df; stroke-width: 1; }
  .axis { stroke: #8a8984; stroke-width: 1; }
  .zero { stroke: #52514e; stroke-width: 1.5; stroke-dasharray: 4 3; }
  .s1 { stroke: #2a78d6; fill: #2a78d6; } .s2 { stroke: #eb6834; fill: #eb6834; } .s3 { stroke: #1baf7a; fill: #1baf7a; }
  .line { fill: none; stroke-width: 2; stroke-linejoin: round; }
  .ring { stroke: #fcfcfb; stroke-width: 2; }
  @media (prefers-color-scheme: dark) {
    .surface { fill: #1a1a19; } .ink, .title { fill: #f0efec; } .ink2 { fill: #c3c2b7; }
    .grid { stroke: #33332f; } .axis { stroke: #6f6e69; } .zero { stroke: #c3c2b7; }
    .s1 { stroke: #3987e5; fill: #3987e5; } .s2 { stroke: #d95926; fill: #d95926; } .s3 { stroke: #199e70; fill: #199e70; }
    .ring { stroke: #1a1a19; }
  }
</style>`;

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (v: number, d = 2): string => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(d));

/** "Nice" ticks covering [lo, hi]. */
function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

export interface DelayPoint {
  delayMs: number;
  netPnl: number;
  roundTrips: number;
}

/**
 * Net P&L vs delay, one line per cost scenario (at most three — further
 * scenarios are left to the CSV rather than given generated colors).
 * Delays are a predeclared grid, so x positions are evenly spaced, not scaled.
 */
export function delayCurveSvg(title: string, series: Map<string, DelayPoint[]>): string {
  const names = [...series.keys()].slice(0, 3);
  const delays = [...new Set(names.flatMap((n) => series.get(n)!.map((p) => p.delayMs)))].sort((a, b) => a - b);
  const values = names.flatMap((n) => series.get(n)!.map((p) => p.netPnl));
  const H = 360;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const x = (d: number): number => PAD.left + (delays.length === 1 ? plotW / 2 : (delays.indexOf(d) / (delays.length - 1)) * plotW);
  const y = (v: number): number => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const L: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}">`, STYLE,
    `<rect class="surface" width="${W}" height="${H}" rx="8"/>`,
    `<text class="title" x="${PAD.left}" y="24">${esc(title)}</text>`];
  for (const t of ticks) {
    L.push(`<line class="${t === 0 ? "zero" : "grid"}" x1="${PAD.left}" x2="${PAD.left + plotW}" y1="${y(t)}" y2="${y(t)}"/>`);
    L.push(`<text class="ink2" x="${PAD.left - 8}" y="${y(t) + 4}" text-anchor="end">${t < 0 ? "−" : ""}$${fmt(Math.abs(t), Math.abs(t) >= 100 || Number.isInteger(t) ? 0 : 2)}</text>`);
  }
  for (const d of delays) L.push(`<text class="ink2" x="${x(d)}" y="${PAD.top + plotH + 18}" text-anchor="middle">${d}</text>`);
  L.push(`<text class="ink2" x="${PAD.left + plotW / 2}" y="${H - 8}" text-anchor="middle">Added decision-to-arrival delay (ms, predeclared grid)</text>`);
  L.push(`<text class="ink2" transform="translate(16 ${PAD.top + plotH / 2}) rotate(-90)" text-anchor="middle">Net P&amp;L, flattened (USD)</text>`);

  names.forEach((name, i) => {
    const pts = [...series.get(name)!].sort((a, b) => a.delayMs - b.delayMs);
    const cls = `s${i + 1}`;
    L.push(`<polyline class="${cls} line" points="${pts.map((p) => `${x(p.delayMs)},${y(p.netPnl)}`).join(" ")}"/>`);
    for (const p of pts) {
      L.push(`<circle class="${cls} ring" cx="${x(p.delayMs)}" cy="${y(p.netPnl)}" r="4.5"><title>${esc(name)} · ${p.delayMs} ms: $${fmt(p.netPnl)} over ${p.roundTrips} round trips</title></circle>`);
    }
    const last = pts[pts.length - 1];
    if (last) L.push(`<text class="ink" x="${x(last.delayMs) + 10}" y="${y(last.netPnl) + 4}">${esc(name)}</text>`);
  });
  // Legend in the header row (always present for ≥ 2 series), clear of the line-end labels.
  if (names.length > 1) {
    let lx = W - 16;
    for (let i = names.length - 1; i >= 0; i--) {
      const textW = names[i].length * 7;
      lx -= textW;
      L.push(`<text class="ink2" x="${lx}" y="24">${esc(names[i])}</text>`);
      L.push(`<rect class="s${i + 1}" x="${lx - 20}" y="18" width="14" height="4" rx="2"/>`);
      lx -= 34;
    }
  }
  L.push("</svg>");
  return L.join("\n");
}

export interface PercentileRow {
  label: string;
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

/** Dot plot of p50 / p95 / p99 per stage on a log10 ms axis. */
export function latencyPercentilesSvg(title: string, rows: PercentileRow[]): string {
  const usable = rows.filter((r) => r.p50 !== null && r.p50 > 0);
  const rowH = 30;
  const H = PAD.top + PAD.bottom + Math.max(1, usable.length) * rowH;
  const labelW = 220;
  const left = PAD.left + labelW - 60;
  const plotW = W - left - 40;
  const all = usable.flatMap((r) => [r.p50, r.p95, r.p99]).filter((v): v is number => v !== null && v > 0);
  const lo = 10 ** Math.floor(Math.log10(Math.min(...all, 0.001)));
  const hi = 10 ** Math.ceil(Math.log10(Math.max(...all, 0.01)));
  const x = (v: number): number => left + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * plotW;
  const L: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}">`, STYLE,
    `<rect class="surface" width="${W}" height="${H}" rx="8"/>`,
    `<text class="title" x="16" y="24">${esc(title)}</text>`];
  for (let e = Math.log10(lo); e <= Math.log10(hi) + 1e-9; e++) {
    const v = 10 ** e;
    L.push(`<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="${PAD.top - 6}" y2="${H - PAD.bottom}"/>`);
    L.push(`<text class="ink2" x="${x(v)}" y="${H - PAD.bottom + 18}" text-anchor="middle">${v >= 1 ? `${v} ms` : `${Number((v * 1000).toPrecision(3))} µs`}</text>`);
  }
  usable.forEach((r, i) => {
    const cy = PAD.top + i * rowH + rowH / 2;
    L.push(`<text class="ink" x="16" y="${cy + 4}">${esc(r.label)}</text>`);
    const marks: Array<[string, number | null, string]> = [["p50", r.p50, "s1"], ["p95", r.p95, "s2"], ["p99", r.p99, "s3"]];
    const shown = marks.filter((m): m is [string, number, string] => m[1] !== null && m[1] > 0);
    if (shown.length > 1) L.push(`<line class="grid" x1="${x(shown[0][1])}" x2="${x(shown[shown.length - 1][1])}" y1="${cy}" y2="${cy}" stroke-width="2"/>`);
    for (const [name, v, cls] of shown) {
      L.push(`<circle class="${cls} ring" cx="${x(v)}" cy="${cy}" r="5"><title>${esc(r.label)} ${name}: ${v < 1 ? `${(v * 1000).toFixed(1)} µs` : `${v.toFixed(3)} ms`} (n=${r.count})</title></circle>`);
    }
  });
  const legendX = W - 200;
  [["p50", "s1"], ["p95", "s2"], ["p99", "s3"]].forEach(([name, cls], i) => {
    L.push(`<circle class="${cls}" cx="${legendX + i * 60}" cy="20" r="5"/><text class="ink2" x="${legendX + i * 60 + 10}" y="24">${name}</text>`);
  });
  L.push(`<text class="ink2" x="16" y="${H - 8}">Percentiles hidden below their sample minimums (p95 n≥100, p99 n≥1,000). Log scale.</text>`);
  L.push("</svg>");
  return L.join("\n");
}
