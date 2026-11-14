/**
 * features/momentum/results/MomentumResultsView.tsx
 *
 * Presentational research-results view over the E2 JSON summary. Every chart
 * carries the strategy, data version, cost model and forward period.
 */

import type { MomentumResultsSummary, ResultsPolicy, WeeklyChoice } from "./types";
import { POLICY_COLORS, POLICY_NAMES, chartLabel, formatDuration, pairedExcludesZero, scale, signedPct } from "./format";

const card = "rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const h2 = "text-sm font-semibold text-zinc-900 dark:text-zinc-50";
const muted = "text-xs text-zinc-500 dark:text-zinc-400";
const th = "px-2 py-1 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400";
const td = "px-2 py-1 text-sm tabular-nums text-zinc-800 dark:text-zinc-200";
const POLICIES: ResultsPolicy[] = ["similarity", "recency", "uniform"];

const W = 640;
const H = 220;
const PAD = { l: 48, r: 12, t: 10, b: 22 };

function Caption({ summary }: { summary: MomentumResultsSummary }) {
  return <p className={`mt-2 ${muted}`}>{chartLabel(summary.meta)}</p>;
}

function Legend() {
  return (
    <ul className="mt-2 flex gap-4 text-xs text-zinc-600 dark:text-zinc-300">
      {POLICIES.map((p) => (
        <li key={p} className="flex items-center gap-1">
          <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: POLICY_COLORS[p] }} />
          {POLICY_NAMES[p]}
        </li>
      ))}
    </ul>
  );
}

function EquityChart({ summary }: { summary: MomentumResultsSummary }) {
  const { equity } = summary;
  if (equity.length === 0) return <p className={muted}>No equity data.</p>;
  const values = equity.flatMap((e) => POLICIES.map((p) => e[p]));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => scale(i, 0, equity.length - 1, PAD.l, W - PAD.r);
  const y = (v: number) => scale(v, lo, hi, H - PAD.b, PAD.t);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Equity curves of the three policies on one calendar" className="w-full">
      {[lo, (lo + hi) / 2, hi].map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#d4d4d8" strokeWidth={0.5} />
          <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize={10} fill="#71717a">{v.toFixed(3)}</text>
        </g>
      ))}
      <text x={PAD.l} y={H - 6} fontSize={10} fill="#71717a">{equity[0].date}</text>
      <text x={W - PAD.r} y={H - 6} fontSize={10} textAnchor="end" fill="#71717a">{equity[equity.length - 1].date}</text>
      {POLICIES.map((p) => (
        <polyline
          key={p}
          fill="none"
          stroke={POLICY_COLORS[p]}
          strokeWidth={p === "uniform" ? 1.25 : 2}
          strokeDasharray={p === "uniform" ? "4 3" : undefined}
          points={equity.map((e, i) => `${x(i).toFixed(1)},${y(e[p]).toFixed(1)}`).join(" ")}
        />
      ))}
    </svg>
  );
}

function PairedChart({ summary }: { summary: MomentumResultsSummary }) {
  const { paired } = summary;
  const rows = paired.intervals;
  const lo = Math.min(0, ...rows.map((r) => r.lo), paired.meanDaily);
  const hi = Math.max(0, ...rows.map((r) => r.hi), paired.meanDaily);
  const rowH = 28;
  const h = PAD.t + rows.length * rowH + PAD.b;
  const x = (v: number) => scale(v, lo, hi, PAD.l + 40, W - PAD.r);
  return (
    <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label="Similarity minus Recency daily return with bootstrap intervals" className="w-full">
      <line x1={x(0)} x2={x(0)} y1={PAD.t} y2={h - PAD.b} stroke="#71717a" strokeDasharray="3 3" />
      <text x={x(0)} y={h - 6} textAnchor="middle" fontSize={10} fill="#71717a">0</text>
      {rows.map((r, i) => {
        const cy = PAD.t + i * rowH + rowH / 2;
        return (
          <g key={r.blockLength}>
            <text x={PAD.l + 32} y={cy + 3} textAnchor="end" fontSize={10} fill="#71717a">{r.blockLength}-day</text>
            <line x1={x(r.lo)} x2={x(r.hi)} y1={cy} y2={cy} stroke={POLICY_COLORS.similarity} strokeWidth={r.primary ? 3 : 1.5} />
            <circle cx={x(paired.meanDaily)} cy={cy} r={r.primary ? 4 : 3} fill={POLICY_COLORS.similarity} />
          </g>
        );
      })}
    </svg>
  );
}

function CostChart({ summary }: { summary: MomentumResultsSummary }) {
  const rows = summary.costSensitivity;
  if (rows.length === 0) return <p className={muted}>No cost sensitivity data.</p>;
  const all = rows.flatMap((r) => POLICIES.map((p) => r[p]));
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const y = (v: number) => scale(v, lo, hi, H - PAD.b, PAD.t);
  const groupW = (W - PAD.l - PAD.r) / rows.length;
  const barW = Math.min(36, (groupW - 16) / 3);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative net return by cost assumption" className="w-full">
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#71717a" strokeWidth={0.75} />
      {[lo, hi].map((v) => (
        <text key={v} x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize={10} fill="#71717a">{signedPct(v, 1)}</text>
      ))}
      {rows.map((r, gi) => {
        const gx = PAD.l + gi * groupW + (groupW - barW * 3) / 2;
        return (
          <g key={r.bps}>
            {POLICIES.map((p, pi) => (
              <rect
                key={p}
                x={gx + pi * barW}
                width={barW - 2}
                y={Math.min(y(r[p]), y(0))}
                height={Math.abs(y(r[p]) - y(0))}
                fill={POLICY_COLORS[p]}
              />
            ))}
            <text x={PAD.l + gi * groupW + groupW / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#71717a">{r.bps} bps</text>
          </g>
        );
      })}
    </svg>
  );
}

function ChoiceCell({ c }: { c: WeeklyChoice }) {
  if (c.configId === null) {
    return <span className="text-amber-700 dark:text-amber-400" title={c.noDeploymentReason ?? undefined}>No deployment</span>;
  }
  return (
    <>
      <span className="font-mono text-xs">{c.configId}</span> <span className={muted}>{signedPct(c.netReturn)}</span>
    </>
  );
}

export function MomentumResultsView({ summary }: { summary: MomentumResultsSummary }) {
  const { policies, paired, weekly } = summary;
  const primary = paired.intervals.find((i) => i.primary);
  return (
    <div className="flex flex-col gap-4">
      <section className={card} aria-label="Policy summary">
        <h2 className={h2}>Policy comparison</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Policy</th>
                <th className={th}>Net return</th>
                <th className={th}>Max drawdown</th>
                <th className={th}>Trades</th>
                <th className={th}>Active days</th>
                <th className={th}>No-deploy weeks</th>
                <th className={th}>Top-weeks share</th>
                <th className={th}>Calibration runtime</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.policy}>
                  <td className={td}>{POLICY_NAMES[p.policy]}</td>
                  <td className={td}>{signedPct(p.cumulativeNetReturn)}</td>
                  <td className={td}>{signedPct(p.maxDrawdown)}</td>
                  <td className={td}>{p.tradeCount}</td>
                  <td className={td}>{p.activeDays}</td>
                  <td className={td}>{p.noDeploymentWeeks}</td>
                  <td className={td}>{(p.concentration.topWeeksShare * 100).toFixed(0)}%</td>
                  <td className={td}>{formatDuration(p.calibrationRuntimeSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card} aria-label="Equity curves">
        <h2 className={h2}>Equity curves (same calendar)</h2>
        <EquityChart summary={summary} />
        <Legend />
        <Caption summary={summary} />
      </section>

      <section className={card} aria-label="Paired difference">
        <h2 className={h2}>Similarity minus Recency (paired daily net return)</h2>
        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
          Mean {signedPct(paired.meanDaily, 3)} per day over {paired.nDays} paired days.
          {primary && (
            <>
              {" "}
              {primary.blockLength}-session block bootstrap ({paired.resamples.toLocaleString()} resamples) interval [{signedPct(primary.lo, 3)}, {signedPct(primary.hi, 3)}]:{" "}
              <strong>{pairedExcludesZero(paired) ? "excludes zero" : "includes zero, so not distinguishable from no difference"}</strong>.
            </>
          )}
        </p>
        <PairedChart summary={summary} />
        <Caption summary={summary} />
      </section>

      <section className={card} aria-label="Cost sensitivity">
        <h2 className={h2}>Cost sensitivity</h2>
        <CostChart summary={summary} />
        <Legend />
        <Caption summary={summary} />
      </section>

      <section className={card} aria-label="Weekly selections">
        <h2 className={h2}>Weekly selected configuration</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Week of</th>
                {POLICIES.map((p) => (
                  <th key={p} className={th}>{POLICY_NAMES[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weekly.map((w) => (
                <tr key={w.weekStart}>
                  <td className={td}>{w.weekStart}</td>
                  {POLICIES.map((p) => (
                    <td key={p} className={td}><ChoiceCell c={w[p]} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Caption summary={summary} />
      </section>
    </div>
  );
}
