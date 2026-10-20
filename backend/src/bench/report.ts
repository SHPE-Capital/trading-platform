/**
 * bench/report.ts
 *
 * Turns a run directory's saved artifacts into latency-summary.csv and
 * decision-report.md (guide §20). Everything is computed from files, so a
 * report can be regenerated or compared later without re-running anything.
 *
 * Rules the report follows:
 *   - Never estimates a missing number. A metric with no samples is "not
 *     measured"; too few samples for a percentile shows the count instead.
 *   - p95 needs ≥ 100 samples and p99 ≥ 1,000 to be printed.
 *   - Synthetic and fixture inputs are labelled as such everywhere.
 *   - Decisions are stated only when the evidence for them exists; otherwise
 *     the report says which evidence is missing.
 *
 * Inputs:  A run directory (manifest.json, metrics.json, data-quality.json,
 *          overhead.json, delay-cost-results.csv, resource summary).
 * Outputs: latency-summary.csv, decision-report.md (and comparison.md).
 */

import fs from "fs";
import path from "path";
import { Histogram, type HistogramJSON } from "../core/telemetry/histogram";
import { RunArtifacts } from "./artifacts";
import type { ProbeSnapshot } from "../core/telemetry/latencyProbe";
import type { ResourceSummary } from "../core/telemetry/resourceMonitor";
import type { RunManifest } from "./manifest";
import type { ProcessingReplayResult } from "./processingReplay";
import type { RecorderStats } from "../core/telemetry/frameRecorder";

export const MIN_COUNT_ANY = 20;
export const MIN_COUNT_P95 = 100;
export const MIN_COUNT_P99 = 1_000;
/** Provisional planning targets from the guide (§19) — not measured facts. */
export const PROVISIONAL_TARGET = { p95Ms: 10, p99Ms: 25 };

export interface OverheadConfigResult {
  config: string;
  repetitions: number;
  throughput_frames_per_s: number[];
  frame_processing_p99_ms: Array<number | null>;
  cpu_ms: number[];
  rss_mb_max: number[];
  decision_checksums: string[];
}

export interface OverheadReport {
  workload: string;
  order: string[];
  configs: OverheadConfigResult[];
  baseline: string;
  gate_throughput_degradation_pct: number;
  evaluation: Array<{
    config: string;
    median_throughput_degradation_pct: number | null;
    /** Added processing time per frame vs disabled, µs (1/throughput difference). */
    added_us_per_frame: number | null;
    outputs_equal: boolean;
  }>;
}

export interface MetricsFile {
  schema_version: number;
  kind: string;
  synthetic: boolean;
  input_label: string;
  probe: ProbeSnapshot | null;
  replay_runs: ProcessingReplayResult[];
  resources: ResourceSummary | null;
  recorder: RecorderStats | null;
  paper: Record<string, unknown> | null;
  notes: string[];
}

interface Row {
  metric: string;
  source: string;
  count: number;
  p50_ms: number | null;
  p90_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  max_ms: number | null;
  unit: string;
  caveat: string;
}

const CAVEATS: Record<string, string> = {
  "event.age_ns.quote": "receive_wall − provider time: upstream + transport + scheduling + clock error; not one-way network latency",
  "event.age_ns.trade": "event-time semantics; late prints arrive old by design",
  "bar.publication_lag_ns": "receive_wall − bar interval END",
  "frame.parse_ns": "per frame (decode + JSON.parse), from callback entry",
  "frame.receive_to_done_ns": "per frame: callback entry until every event in it was dispatched through all synchronous handlers",
  "engine.evaluate_ns": "per strategy evaluation, including no-signal evaluations",
  "order.journal_ns": "awaited durable write before sending; required, fail-closed",
  "order.receive_to_submit_ns": "only events that produced an order; includes event-loop scheduling before the async journal",
  "order.submit_to_response_ns": "HTTP client boundary (or null sink); not exchange arrival",
  "order.submit_to_first_update_ns": "first order update after submit; paper fills are simulated by Alpaca",
  "replay.scheduled_to_done_ns": "includes queueing behind earlier frames (coordinated-omission corrected)",
};

function pct(h: Histogram, q: number, minCount: number): number | null {
  if (h.count < minCount) return null;
  const v = h.percentile(q);
  return v === null ? null : v / 1e6;
}

function rowFrom(metric: string, source: string, json: HistogramJSON): Row {
  const h = Histogram.fromJSON(json);
  return {
    metric, source, count: h.count,
    p50_ms: pct(h, 0.5, 1), p90_ms: pct(h, 0.9, 10),
    p95_ms: pct(h, 0.95, MIN_COUNT_P95), p99_ms: pct(h, 0.99, MIN_COUNT_P99),
    max_ms: h.max === null ? null : h.max / 1e6,
    unit: "ms",
    caveat: CAVEATS[metric] ?? (metric.endsWith(".negative") ? "magnitudes of NEGATIVE ages: clock offset or provider stamping — investigate" : ""),
  };
}

const fmt = (v: number | null | undefined, digits = 3): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Minimal CSV reader for our own (unquoted-numeric) CSV files. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = split(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

export interface ReportOutputs {
  summaryRows: Row[];
  markdown: string;
}

export function buildReport(run: RunArtifacts): ReportOutputs {
  const manifest = run.readJson<RunManifest>("manifest.json");
  const metrics = run.readJson<MetricsFile>("metrics.json");
  const quality = run.readJson<Record<string, unknown>>("data-quality.json");
  const overhead = run.readJson<OverheadReport>("overhead.json");
  const delayRows = run.exists("delay-cost-results.csv")
    ? parseCsv(fs.readFileSync(run.path("delay-cost-results.csv"), "utf8"))
    : [];

  const rows: Row[] = [];
  const probe = metrics?.probe ?? null;
  if (probe) {
    for (const [name, json] of Object.entries(probe.histograms)) {
      if (json.unit === "ns") rows.push(rowFrom(name, "probe", json));
    }
  }
  for (const [i, rr] of (metrics?.replay_runs ?? []).entries()) {
    rows.push(rowFrom(`replay[${i}].frame_processing_ns`, "replay-driver", rr.histograms.frame_processing_ns));
    rows.push(rowFrom(`replay[${i}].scheduled_to_done_ns`, "replay-driver", rr.histograms.scheduled_to_done_ns));
    rows.push(rowFrom(`replay[${i}].generator_lateness_ns`, "replay-driver", rr.histograms.generator_lateness_ns));
  }
  const res = metrics?.resources ?? null;
  if (res && res.event_loop_delay_ms.p50 !== null) {
    rows.push({
      metric: "event_loop.delay", source: "perf_hooks", count: res.samples,
      p50_ms: res.event_loop_delay_ms.p50, p90_ms: res.event_loop_delay_ms.p90, p95_ms: null,
      p99_ms: res.event_loop_delay_ms.p99, max_ms: res.event_loop_delay_ms.max, unit: "ms",
      caveat: `delay beyond a ${res.event_loop_resolution_ms} ms timer; count = resource samples${res.timer_caveat ? "; unreliable on Windows" : ""}`,
    });
  }

  const md = renderMarkdown({ run, manifest, metrics, quality, overhead, delayRows, rows });
  return { summaryRows: rows, markdown: md };
}

export function writeReport(run: RunArtifacts): ReportOutputs {
  const out = buildReport(run);
  run.writeCsv("latency-summary.csv", out.summaryRows as unknown as Array<Record<string, unknown>>,
    ["metric", "source", "count", "p50_ms", "p90_ms", "p95_ms", "p99_ms", "max_ms", "unit", "caveat"]);
  run.writeText("decision-report.md", out.markdown);
  return out;
}

interface RenderInput {
  run: RunArtifacts;
  manifest: RunManifest | null;
  metrics: MetricsFile | null;
  quality: Record<string, unknown> | null;
  overhead: OverheadReport | null;
  delayRows: Array<Record<string, string>>;
  rows: Row[];
}

function findRow(rows: Row[], metric: string): Row | undefined {
  return rows.find((r) => r.metric === metric && r.source === "probe");
}

function tableCell(r: Row | undefined): string[] {
  if (!r || r.count === 0) return ["0", "not measured", "—", "—", "—"];
  if (r.count < MIN_COUNT_ANY) return [String(r.count), `insufficient (n<${MIN_COUNT_ANY})`, "—", "—", fmt(r.max_ms)];
  return [String(r.count), fmt(r.p50_ms), r.p95_ms === null ? `n<${MIN_COUNT_P95}` : fmt(r.p95_ms),
    r.p99_ms === null ? `n<${MIN_COUNT_P99}` : fmt(r.p99_ms), fmt(r.max_ms)];
}

function renderMarkdown(x: RenderInput): string {
  const { run, manifest, metrics, quality, overhead, delayRows, rows } = x;
  const L: string[] = [];
  const probe = metrics?.probe ?? null;
  const synthetic = metrics?.synthetic ?? false;
  const kind = metrics?.kind ?? manifest?.command ?? "unknown";
  const counters = probe?.counters ?? {};
  const c = (k: string): number => counters[k] ?? 0;

  L.push(`# Latency benchmark decision report — ${run.runId}`);
  L.push("");
  L.push(`Generated ${new Date().toISOString()} from saved artifacts. Blank or "—" cells were not measured; nothing here is estimated.`);
  if (synthetic) L.push("", "> **Synthetic input.** Rates, prices and timing were generated, not captured. Use these numbers for processing cost and correctness only — not as evidence of live Alpaca/IEX behaviour.");
  if (manifest && !manifest.validity.valid) L.push("", `> **Run marked not comparable:** ${manifest.validity.reasons.join("; ")}`);

  // 1. Question and scope
  const runInfo = (manifest?.run ?? {}) as Record<string, unknown>;
  L.push("", "## 1. Question and scope", "");
  L.push(`- Command: \`${kind}\`; input: ${metrics?.input_label ?? "—"}`);
  L.push(`- Feed: ${String(runInfo["feed"] ?? "—")}; symbols: ${JSON.stringify(runInfo["symbols"] ?? "—")}`);
  L.push(`- Strategy: ${JSON.stringify(runInfo["strategy"] ?? "—")}; order sink: ${String(runInfo["sink"] ?? "—")} (broker orders submitted: ${String(runInfo["broker_orders_submitted"] ?? "none")})`);
  L.push(`- Reaction deadline under test: ${String(runInfo["deadline_ms"] ?? "—")} ms`);
  L.push("- Excluded claims: exchange-to-host latency, consolidated-market coverage, HFT capability, profitability.");

  // 2. Environment
  L.push("", "## 2. Environment", "");
  if (manifest) {
    const code = manifest.code as Record<string, unknown>;
    const host = manifest.host as Record<string, unknown>;
    const ec2 = host["ec2"] as Record<string, unknown> | null;
    L.push(`- Code: ${String(code["git_sha"] ?? "—")}${code["dirty"] ? " (dirty working tree)" : ""}`);
    L.push(`- Host: ${String(host["platform"])} ${String(host["arch"])}, ${String(host["cpu_count"])} CPUs (${String(host["cpu_model"])}), ${String(host["total_memory_mb"])} MB${ec2 ? `; EC2 ${String(ec2["instance_type"])} in ${String(ec2["availability_zone"])}${ec2["burstable"] ? " (burstable: check CPUCreditBalance in CloudWatch)" : ""}` : "; not EC2"}`);
    L.push(`- Runtime: Node ${String((manifest.runtime as Record<string, unknown>)["node"])}; container CPU limit: ${String((manifest.limits as Record<string, unknown>)["cgroup_cpu_limit_cores"] ?? "none/unknown")}`);
    const clock = manifest.clock as Record<string, unknown>;
    const syncKeys = Object.keys(clock).filter((k) => /chrony|timedatectl|w32tm|sntp/.test(k));
    L.push(`- Clock sync evidence: ${syncKeys.length ? syncKeys.join(", ") + " (see manifest.json)" : "**none collected** — external event ages are inconclusive"}`);
    if (manifest.unavailable.length) L.push(`- Unavailable: ${manifest.unavailable.join("; ")}`);
  } else {
    L.push("- manifest.json missing.");
  }

  // 3. Data integrity
  L.push("", "## 3. Data integrity", "");
  if (probe) {
    L.push(`- Frames received: ${c("frames.received")}; parse failures: ${c("frames.parse_failed")}`);
    L.push(`- Events: quotes ${c("events.quote")}, trades ${c("events.trade")}, bars ${c("events.bar")}`);
    const issues = Object.entries(counters).filter(([k]) => k.startsWith("issues."));
    L.push(`- Validation issues: ${issues.length ? issues.map(([k, v]) => `${k.slice(7)}=${v}`).join(", ") : "none"}`);
    const quarantined = Object.entries(counters).filter(([k]) => k.startsWith("quarantined."));
    L.push(`- Quarantined: ${quarantined.length ? quarantined.map(([k, v]) => `${k.slice(12)}=${v}`).join(", ") : "none (policy: pass, or nothing rejected)"}`);
    const unhandled = Object.entries(counters).filter(([k]) => k.startsWith("messages.unhandled."));
    L.push(`- Unhandled message types: ${unhandled.length ? unhandled.map(([k, v]) => `${k.slice(19)}=${v}`).join(", ") : "none"}`);
    const negQ = c("event.age_ns.quote.negative_count"), negT = c("event.age_ns.trade.negative_count");
    if (negQ || negT) L.push(`- **Negative event ages**: quotes ${negQ}, trades ${negT} — kept as a separate distribution; investigate clock offset.`);
    L.push(`- Connection lifecycle: ${probe.lifecycle.length} records; reconnects scheduled ${c("lifecycle.reconnect_scheduled")}; subscription acks ${c("lifecycle.subscription_ack")}`);
    L.push(`- Trace sampling: ${probe.sampling.traces_sampled} of ${probe.sampling.traces_total} events sampled (p=${probe.sampling.probability}); ${probe.sampling.traces_retained} retained; evictions ${probe.sampling.open_trace_evictions}/${probe.sampling.intent_evictions}`);
  } else {
    L.push("- No probe snapshot in this run.");
  }
  const rec = metrics?.recorder ?? null;
  if (rec) {
    L.push(`- Recorder: ${rec.records_written} written, ${rec.records_dropped} dropped, ${rec.records_redacted} redacted, state ${rec.state}${rec.complete ? "" : " — **dataset incomplete**"}`);
    if (rec.gaps.length) L.push(`- Recorder gaps: ${rec.gaps.slice(0, 5).map((g) => `seq ${g.first_seq}–${g.last_seq} (${g.reason})`).join("; ")}${rec.gaps.length > 5 ? " …" : ""}`);
  }
  L.push("- Internal accounting shows only what this process received; it cannot prove the upstream stream was complete.");
  if (quality) L.push(`- Fixture correctness checks: ${String((quality as Record<string, unknown>)["passed"] ?? "—")} (see data-quality.json)`);

  // 4. Latency decomposition
  L.push("", "## 4. Latency decomposition", "");
  L.push("| Metric | Count | p50 | p95 | p99 | Maximum | Unit | Caveat |");
  L.push("|---|---|---|---|---|---|---|---|");
  const table: Array<[string, string, string]> = [
    ["Quote observed age", "event.age_ns.quote", "External clocks and upstream delay"],
    ["Trade observed age", "event.age_ns.trade", "Event-time semantics and late prints"],
    ["Bar publication lag", "bar.publication_lag_ns", "From interval end"],
    ["Frame parse", "frame.parse_ns", "Per frame, not per event"],
    ["Frame receive-to-done", "frame.receive_to_done_ns", "Receipt to last event dispatched (all sync handlers)"],
    ["Quote normalize", "event.normalize_ns.quote", "Per event; stage detail only"],
    ["Quote dispatch (sync handlers)", "event.dispatch_ns.quote", "Stage detail only; contains state + evaluate + risk"],
    ["Strategy evaluation", "engine.evaluate_ns", "Stage detail only; includes no-signal evaluations"],
    ["Risk + reservation", "engine.risk_ns.quote", "Per intent"],
    ["Required journal wait", "order.journal_ns", "Preserve durability"],
    ["Application receive-to-submit", "order.receive_to_submit_ns", "Only events producing an order"],
    ["Submit-to-response headers", "order.submit_to_response_headers_ns", "fetch resolved; Alpaca targets only"],
    ["Submit-to-response", "order.submit_to_response_ns", "HTTP client boundary, not exchange arrival"],
    ["Submit-to-first update", "order.submit_to_first_update_ns", "Paper simulation; report unfilled count"],
  ];
  for (const [label, metric, caveat] of table) {
    const [n, p50, p95, p99, max] = tableCell(findRow(rows, metric));
    L.push(`| ${label} | ${n} | ${p50} | ${p95} | ${p99} | ${max} | ms | ${caveat} |`);
  }
  const res = metrics?.resources ?? null;
  L.push(`| Event-loop delay | ${res?.samples ?? 0} samples | ${fmt(res?.event_loop_delay_ms.p50)} | — | ${fmt(res?.event_loop_delay_ms.p99)} | ${fmt(res?.event_loop_delay_ms.max)} | ms | perf_hooks sampler resolution ${res?.event_loop_resolution_ms ?? "—"} ms |`);
  L.push("", "Full distributions: latency-summary.csv. Parent and child spans overlap; never sum stage percentiles into an end-to-end figure.");

  // 5. Capacity
  L.push("", "## 5. Capacity", "");
  const runs = metrics?.replay_runs ?? [];
  if (runs.length) {
    L.push("| Rep | Pacing | Frames | Throughput (frames/s) | Processing p99 ms | Sched→done p99 ms | Late >1ms | Deadline misses | Decision checksum |");
    L.push("|---|---|---|---|---|---|---|---|---|");
    runs.forEach((r, i) => {
      const pacing = r.pacing.mode === "max" ? "max" : `${r.pacing.speed}x`;
      L.push(`| ${i} | ${pacing} | ${r.frames_measured} | ${fmt(r.throughput_frames_per_s, 0)} | ${fmt(r.frame_processing.p99_ms)} | ${fmt(r.scheduled_to_done.p99_ms)} | ${r.late_frames_over_1ms} | ${r.deadline_misses} | \`${String(r.decisions["decision_checksum"]).slice(0, 12)}\` |`);
    });
    const sums = new Set(runs.map((r) => String(r.decisions["decision_checksum"])));
    L.push("", sums.size === 1 ? "- Repeated runs produced identical decisions." : `- **Decisions differed across repetitions** (${sums.size} distinct checksums): investigate nondeterminism before comparing timings.`);
    const tps = runs.map((r) => r.throughput_frames_per_s).filter((v): v is number => v !== null);
    if (tps.length >= 2) {
      const m = tps.reduce((a, b) => a + b, 0) / tps.length;
      const spread = (Math.max(...tps) - Math.min(...tps)) / m;
      L.push(`- Throughput spread across repetitions: ${(spread * 100).toFixed(1)}% of the mean — differences smaller than this are not evidence.`);
    }
  } else {
    L.push("- No replay runs in this artifact.");
  }

  // 6. Resources
  L.push("", "## 6. Resource behaviour", "");
  if (res) {
    L.push(`- CPU (% of one core): mean ${fmt(res.cpu_pct_of_one_core_mean, 1)}, max ${fmt(res.cpu_pct_of_one_core_max, 1)}`);
    L.push(`- Event-loop utilization mean: ${fmt(res.event_loop_utilization_mean)}`);
    L.push(`- RSS max ${fmt(res.rss_mb_max, 1)} MB (growth ${fmt(res.rss_mb_growth, 1)} MB); heap max ${fmt(res.heap_used_mb_max, 1)} MB`);
    L.push(`- GC: ${res.gc_major_count} major collections; pause total ${fmt(res.gc_pause_ms_total, 1)} ms, max ${fmt(res.gc_pause_ms_max, 2)} ms`);
    L.push(`- Container CPU throttling: ${res.cgroup_throttled_ms_total === null ? "not available (not a cgroup v2 container)" : `${fmt(res.cgroup_throttled_ms_total, 1)} ms`}`);
    L.push(`- Clock discontinuities: ${res.clock_discontinuities.length ? `**${res.clock_discontinuities.length}** — split external-age analysis at these points` : "none detected"}`);
    if (res.timer_caveat) L.push(`- **${res.timer_caveat}**`);
  } else {
    L.push("- No resource samples.");
  }

  // 7. Orders
  L.push("", "## 7. Order observations", "");
  const paper = metrics?.paper ?? null;
  if (paper) {
    L.push("```json", JSON.stringify(paper, null, 2), "```");
  } else {
    L.push(`- No broker orders were submitted in this run (sink: ${String(runInfo["sink"] ?? "—")}). Order-path timings above, if any, are against the null/simulated sink and in-memory journal.`);
  }

  // 8. Strategy sensitivity
  L.push("", "## 8. Strategy delay and cost sensitivity", "");
  const delayVerdict = delayRows.length ? judgeDelay(delayRows) : null;
  if (delayRows.length) {
    L.push("| Split | Cost | Delay ms | Orders | Filled | Unfilled (stale/none/size) | Round trips | Net P&L (flattened) | Per-trade mean ± SE | Max DD |");
    L.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const r of delayRows.filter((d) => d["seed"] === delayRows[0]["seed"])) {
      L.push(`| ${r["split"]} | ${r["cost_scenario"]} | ${r["delay_ms"]} | ${r["orders"]} | ${r["filled"]}+${r["partial"]}p | ${r["unfilled_stale_quote"]}/${r["unfilled_no_quote"]}/${r["unfilled_no_displayed_size"]} | ${r["round_trips"]} | ${fmt(Number(r["net_pnl_flattened"]), 2)} | ${fmt(Number(r["per_trade_pnl_mean"]), 4)} ± ${fmt(Number(r["per_trade_pnl_stderr"]), 4)} | ${fmt(Number(r["max_drawdown_usd"]), 2)} |`);
    }
    L.push("", `- ${delayVerdict}`);
    L.push("- Fills cross IEX top of book with slippage and fees; no queue position, impact or hidden liquidity. An approximation.");
  } else {
    L.push("- Not run in this artifact (see `bench delay`).");
  }

  // 9. Comparison / overhead
  L.push("", "## 9. Instrumentation overhead and repeatability", "");
  if (overhead) {
    L.push(`Workload: ${overhead.workload}. Interleaved order: ${overhead.order.join(" → ")}.`, "");
    L.push("| Config | Reps | Median throughput (frames/s) | Spread | Degradation vs disabled | Added µs/frame | Outputs equal |");
    L.push("|---|---|---|---|---|---|---|");
    for (const cfg of overhead.configs) {
      const ev = overhead.evaluation.find((e) => e.config === cfg.config);
      const tps = cfg.throughput_frames_per_s;
      const m = median(tps);
      const spread = m && tps.length > 1 ? `${(((Math.max(...tps) - Math.min(...tps)) / m) * 100).toFixed(0)}%` : "—";
      L.push(`| ${cfg.config} | ${cfg.repetitions} | ${fmt(m, 0)} | ${spread} | ${ev?.median_throughput_degradation_pct === null || ev === undefined ? "—" : `${ev.median_throughput_degradation_pct.toFixed(2)}%`} | ${fmt(ev?.added_us_per_frame, 2)} | ${ev?.outputs_equal ? "yes" : "**no**"} |`);
    }
    L.push("", `Provisional gate: < ${overhead.gate_throughput_degradation_pct}% throughput degradation for the intended config ("sampled"). Measured here at MAXIMUM throughput, which is conservative: at the planned live rate the cost that matters is the added µs per frame against the reaction budget. If the spread of "disabled" exceeds the degradation, this host is too noisy to judge the gate — rerun on the target host. This is an engineering criterion, not a provider guarantee.`);
  } else {
    L.push("- No A/A overhead experiment in this run.");
  }

  // 10. Recommendation
  L.push("", "## 10. Recommendation", "");
  for (const line of recommend({ rows, metrics, manifest, overhead, delayVerdict, synthetic })) L.push(`- ${line}`);

  // 11. Reproduction
  L.push("", "## 11. Reproduction", "");
  L.push("```sh", manifest ? `node dist/runtime/bench.js ${manifest.argv.join(" ")}` : "(manifest missing)", "```");
  const hashes = runInfo["input_hash"] ?? runInfo["recording_hashes"];
  if (hashes) L.push(`Input identity: \`${typeof hashes === "string" ? hashes : JSON.stringify(hashes)}\``);

  // 12. Limitations
  L.push("", "## 12. Limitations", "");
  L.push("- Receive time is application-visible receipt (after kernel, TLS, WebSocket decode and event-loop scheduling), not NIC arrival.");
  L.push("- Observed event age mixes provider processing, transport, local scheduling and clock offset; it is not one-way network latency.");
  L.push("- Free IEX is a single-exchange view; quote sizes are round lots; it is not the NBBO.");
  L.push("- submit_start is before DNS/TLS/client queues; it is not wire-send time. Response headers = fetch resolved (Alpaca targets only).");
  L.push("- Alpaca paper fills are simulated (no queue position, impact or latency slippage).");
  if (synthetic) L.push("- Synthetic workload: not calibrated to live traffic unless stated in the manifest.");
  for (const n of metrics?.notes ?? []) L.push(`- ${n}`);
  return L.join("\n") + "\n";
}

/** Applies the plan's written criterion to the base scenario of the evaluation (or only) split. */
export function judgeDelay(rows: Array<Record<string, string>>): string {
  const split = rows.some((r) => r["split"] === "evaluation") ? "evaluation" : rows[0]["split"];
  const scenario = rows.some((r) => r["cost_scenario"] === "base") ? "base" : rows[0]["cost_scenario"];
  const cells = rows
    .filter((r) => r["split"] === split && r["cost_scenario"] === scenario)
    .sort((a, b) => Number(a["delay_ms"]) - Number(b["delay_ms"]));
  if (cells.length === 0) return "No cells for the judged split/scenario.";
  const ok = (r: Record<string, string>): boolean => {
    const net = Number(r["net_pnl_flattened"]);
    const n = Number(r["round_trips"]);
    const se = Number(r["per_trade_pnl_stderr"]);
    return n >= 30 && Number.isFinite(se) && net > 2 * se * n;
  };
  const zero = cells[0];
  if (Number(zero["round_trips"]) < 30) {
    return `Insufficient sample: ${zero["round_trips"]} round trips at ${zero["delay_ms"]} ms (${split}/${scenario}); no conclusion about delay sensitivity.`;
  }
  if (!ok(zero)) {
    return `Net result is not positive beyond two standard errors even at ${zero["delay_ms"]} ms added delay (${split}/${scenario}). Revisit the strategy and cost assumptions before tuning latency.`;
  }
  const firstFail = cells.find((r) => !ok(r));
  if (!firstFail) return `Result stays positive beyond two standard errors across all tested delays up to ${cells[cells.length - 1]["delay_ms"]} ms (${split}/${scenario}); latency is not the binding constraint in this range.`;
  const idx = cells.indexOf(firstFail);
  return `Result stops clearing two standard errors between ${cells[idx - 1]["delay_ms"]} and ${firstFail["delay_ms"]} ms of added delay (${split}/${scenario}).`;
}

function recommend(x: {
  rows: Row[];
  metrics: MetricsFile | null;
  manifest: RunManifest | null;
  overhead: OverheadReport | null;
  delayVerdict: string | null;
  synthetic: boolean;
}): string[] {
  const out: string[] = [];
  const r2s = findRow(x.rows, "order.receive_to_submit_ns");
  if (!r2s || r2s.count === 0) {
    out.push("Receive-to-submit was not measured in this run: no event produced an order through an instrumented path.");
  } else if (r2s.count < MIN_COUNT_P99) {
    out.push(`Receive-to-submit has ${r2s.count} samples; the provisional p95 ≤ ${PROVISIONAL_TARGET.p95Ms} ms / p99 ≤ ${PROVISIONAL_TARGET.p99Ms} ms target is **not established** (needs ≥ ${MIN_COUNT_P99}).`);
  } else {
    const meets = (r2s.p95_ms ?? Infinity) <= PROVISIONAL_TARGET.p95Ms && (r2s.p99_ms ?? Infinity) <= PROVISIONAL_TARGET.p99Ms;
    out.push(`Receive-to-submit p95 ${fmt(r2s.p95_ms)} ms, p99 ${fmt(r2s.p99_ms)} ms (n=${r2s.count}): ${meets ? "inside" : "**outside**"} the provisional planning target${x.synthetic ? " — on synthetic input" : ""}.`);
  }
  const journal = findRow(x.rows, "order.journal_ns");
  if (journal && r2s && journal.count >= MIN_COUNT_ANY && journal.p50_ms !== null && r2s.p50_ms !== null && r2s.p50_ms > 0) {
    const share = journal.p50_ms / (r2s.p50_ms + journal.p50_ms);
    if (share > 0.5) out.push("The required journal wait dominates the median order path: review journal locality/latency, keeping fail-closed semantics.");
  }
  const res = x.metrics?.resources;
  if (res?.event_loop_delay_ms.p99 !== null && res?.event_loop_delay_ms.p99 !== undefined && res.event_loop_delay_ms.p99 > 10 && !res.timer_caveat) {
    out.push(`Event-loop delay p99 is ${fmt(res.event_loop_delay_ms.p99)} ms: find the blocking work (logging, scans, GC, co-located jobs) before any micro-optimization.`);
  }
  if (x.overhead) {
    const bad = x.overhead.evaluation.filter((e) => !e.outputs_equal);
    if (bad.length) out.push(`Instrumented configs changed decisions (${bad.map((b) => b.config).join(", ")}): instrumentation is not behaviour-neutral; fix before trusting numbers.`);
    const sampled = x.overhead.evaluation.find((e) => e.config === "sampled");
    if (sampled?.median_throughput_degradation_pct !== null && sampled?.median_throughput_degradation_pct !== undefined) {
      out.push(sampled.median_throughput_degradation_pct < x.overhead.gate_throughput_degradation_pct
        ? `Intended sampling config costs ${sampled.median_throughput_degradation_pct.toFixed(2)}% throughput: within the provisional gate.`
        : `Intended sampling config costs ${sampled.median_throughput_degradation_pct.toFixed(2)}% throughput: **above** the provisional gate — reduce overhead before using instrumented numbers to choose optimizations.`);
    }
  }
  const clockKeys = x.manifest ? Object.keys(x.manifest.clock).filter((k) => /chrony|timedatectl|w32tm|sntp/.test(k)) : [];
  if (findRow(x.rows, "event.age_ns.quote")?.count && clockKeys.length === 0) {
    out.push("External event ages were recorded without clock-synchronisation evidence: treat them as inconclusive.");
  }
  if (x.delayVerdict) out.push(x.delayVerdict);
  if (x.synthetic) out.push("Next evidence needed: a live-shadow capture (bench capture) during market hours, then replay of that capture on the target AWS host.");
  if (out.length === 0) out.push("Insufficient evidence for a recommendation in this run.");
  return out;
}

/** Side-by-side comparison of several runs' headline metrics. */
export function writeComparison(base: RunArtifacts, others: RunArtifacts[]): string {
  const all = [base, ...others];
  const headline = [
    "order.receive_to_submit_ns", "engine.evaluate_ns", "event.dispatch_ns.quote", "frame.parse_ns", "order.journal_ns",
  ];
  const L: string[] = [`# Run comparison`, "", `| Metric | ${all.map((r) => r.runId).join(" | ")} |`, `|---|${all.map(() => "---").join("|")}|`];
  const reports = all.map((r) => buildReport(r));
  for (const m of headline) {
    L.push(`| ${m} p50/p99 ms | ${reports.map((rep) => {
      const row = findRow(rep.summaryRows, m);
      return row ? `${fmt(row.p50_ms)} / ${row.p99_ms === null ? `n=${row.count}` : fmt(row.p99_ms)}` : "—";
    }).join(" | ")} |`);
  }
  const manifests = all.map((r) => r.readJson<RunManifest>("manifest.json"));
  L.push(`| input identity | ${manifests.map((m) => `\`${String((m?.run ?? {})["input_hash"] ?? "—").slice(0, 12)}\``).join(" | ")} |`);
  L.push(`| code | ${manifests.map((m) => `\`${String((m?.code ?? {})["git_sha"] ?? "—").slice(0, 10)}\`${(m?.code ?? {})["dirty"] ? "*" : ""}`).join(" | ")} |`);
  L.push(`| host | ${manifests.map((m) => String((m?.host ?? {})["hostname"] ?? "—")).join(" | ")} |`);
  const metrics = all.map((r) => r.readJson<MetricsFile>("metrics.json"));
  L.push(`| decision checksums | ${metrics.map((m) => [...new Set((m?.replay_runs ?? []).map((rr) => String(rr.decisions["decision_checksum"]).slice(0, 10)))].join(",") || "—").join(" | ")} |`);
  const inputs = new Set(manifests.map((m) => String((m?.run ?? {})["input_hash"] ?? "")));
  L.push("", inputs.size === 1 && !inputs.has("") ? "Inputs are identical across runs." : "**Inputs differ (or are unidentified): differences may reflect workload, not the host or code.**");
  const text = L.join("\n") + "\n";
  base.writeText(`comparison-${others.map((o) => path.basename(o.dir)).join("_").slice(0, 80)}.md`, text);
  return text;
}
