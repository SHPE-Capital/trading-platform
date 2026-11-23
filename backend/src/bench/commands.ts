/**
 * bench/commands.ts
 *
 * The offline benchmark commands — no credentials, no network, no broker:
 *
 *   fixture        correctness on the checked-in fixture, then a synthetic
 *                  processing benchmark and an A/A instrumentation-overhead test
 *   replay         processing benchmark over a saved recording
 *   delay          strategy delay × cost sensitivity over a recording (or a
 *                  labelled synthetic session), driven by a predeclared plan
 *   report         (re)build decision-report.md, optionally comparing runs
 *   plan-template  write a delay-plan template to edit before running
 *
 * Each command writes an immutable artifacts/latency/<run-id>/ directory.
 * fetch() is replaced by a counting stub that throws, so these modes cannot
 * reach a broker even by accident; the count is recorded in the manifest.
 *
 * Inputs:  Parsed Args.
 * Outputs: Run directory path; process exit code via thrown errors.
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { LatencyProbe } from "../core/telemetry/latencyProbe";
import { ResourceMonitor } from "../core/telemetry/resourceMonitor";
import { FrameRecorder, emptyReadReport, listSegments, readRecording, RECORDING_INDEX_FILE, type RecordingRecord } from "../core/telemetry/frameRecorder";
import { parseRfc3339ToEpochNs } from "../core/telemetry/clock";
import { NORMALIZER_VERSION } from "../adapters/alpaca/normalizer";
import { RunArtifacts, defaultArtifactsBase, newRunId, knownSecretValues } from "./artifacts";
import { buildManifest, invalidate, type RunManifest } from "./manifest";
import { buildBenchEngine, type BenchSinkKind } from "./engine";
import { runProcessingReplay, type BurstWindow, type PacingOptions, type ProcessingReplayResult } from "./processingReplay";
import { buildEdgeCaseFixture, EDGE_CASE_EXPECTATIONS } from "./fixtures/edgeCaseFixture";
import { generateSyntheticFrames, type BurstSpec, type SyntheticWorkloadOptions } from "./syntheticWorkload";
import { BENCH_STRATEGY_NAMES, benchStrategyVersion, type BenchStrategyName, type BenchStrategySpec } from "./strategies";
import {
  delayPlanTemplate,
  loadObservedEvents,
  samplesFromHistogram,
  simulateDelayRun,
  sliceByDate,
  validateDelayPlan,
  type DelayPlan,
  type DelayRunResult,
  type ObservedEvent,
  type ObservedEventsReport,
  type SegmentRow,
} from "./delaySimulator";
import { writeComparison, writeReport, type MetricsFile, type OverheadReport, type OverheadConfigResult } from "./report";
import { Args, ArgError } from "./args";
import type { ProbeSnapshot } from "../core/telemetry/latencyProbe";
import { env } from "../config/env";

// ------------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------------

/** Replaces fetch with a stub that throws, for modes that must not touch the network. */
export function guardNetwork(): { calls: () => number; restore: () => void } {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("Network access is disabled in this benchmark mode");
  }) as typeof fetch;
  return { calls: () => calls, restore: () => { globalThis.fetch = original; } };
}

export function parseBursts(spec: string | undefined): Array<{ startMs: number; durationMs: number; multiplier: number }> {
  if (!spec || spec === "none") return [];
  return spec.split(",").map((part) => {
    const [a, b, c] = part.split(":").map(Number);
    if (![a, b, c].every((n) => Number.isFinite(n)) || b <= 0 || c <= 0) {
      throw new ArgError(`Bad burst "${part}": expected startMs:durationMs:multiplier`);
    }
    return { startMs: a, durationMs: b, multiplier: c };
  });
}

function strategySpec(args: Args, symbols: string[]): BenchStrategySpec {
  const name = args.choice<BenchStrategyName>("strategy", BENCH_STRATEGY_NAMES, "quote_imbalance");
  const count = args.num("strategy-count", 1, { min: 1, max: 500, integer: true });
  const rawParams = args.optStr("strategy-params");
  let params: Record<string, unknown> | undefined;
  if (rawParams) {
    try {
      params = JSON.parse(rawParams) as Record<string, unknown>;
    } catch {
      throw new ArgError("--strategy-params must be a JSON object");
    }
  }
  return { name, count, symbols, params };
}

interface ProcessingOptions {
  strategy: BenchStrategySpec;
  sink: BenchSinkKind;
  journalLatencyMs: number;
  journalFailEvery: number;
  invalidData: "pass" | "quarantine";
  pacing: PacingOptions;
  warmupFrames: number;
  repetitions: number;
  sampleProbability: number;
  deadlineMs: number;
  detail: "frame" | "stage";
}

function processingOptions(args: Args, symbols: string[]): ProcessingOptions {
  const pacingMode = args.choice("pacing", ["max", "paced"] as const, "max");
  const speed = args.num("speed", 1, { min: 0.01, max: 1000 });
  const replayBursts: BurstWindow[] = parseBursts(args.optStr("replay-burst")).map((b) => ({
    startOffsetMs: b.startMs, durationMs: b.durationMs, speedMultiplier: b.multiplier,
  }));
  if (pacingMode === "max" && replayBursts.length) throw new ArgError("--replay-burst needs --pacing paced");
  return {
    strategy: strategySpec(args, symbols),
    sink: args.choice<BenchSinkKind>("sink", ["null", "sim"], "null"),
    journalLatencyMs: args.num("journal-latency-ms", 0, { min: 0, max: 10_000 }),
    journalFailEvery: args.num("journal-fail-every", 0, { min: 0, integer: true }),
    invalidData: args.choice("invalid-data", ["pass", "quarantine"] as const, env.marketDataInvalidPolicy),
    pacing: pacingMode === "max" ? { mode: "max" } : { mode: "paced", speed, bursts: replayBursts },
    warmupFrames: args.num("warmup-frames", 500, { min: 0, integer: true }),
    repetitions: args.num("repetitions", 3, { min: 1, max: 50, integer: true }),
    sampleProbability: args.num("sample", 0.01, { min: 0, max: 1 }),
    deadlineMs: args.num("deadline-ms", 10, { min: 0 }),
    detail: args.choice("detail", ["frame", "stage"] as const, "frame"),
  };
}

export function newProbe(runId: string, sample: number, deadlineMs: number, detail: "frame" | "stage" = "frame"): LatencyProbe {
  return new LatencyProbe({
    runId,
    detail,
    sampleProbability: sample,
    normalizationVersion: NORMALIZER_VERSION,
    deadlinesMs: {
      "order.receive_to_submit_ns": deadlineMs,
      "replay.scheduled_to_done_ns": deadlineMs,
      "event.receive_to_dispatch_end_ns.quote": deadlineMs,
      "frame.receive_to_done_ns": deadlineMs,
    },
  });
}

/** Runs the processing benchmark `repetitions` times on one probe (histograms accumulate). */
async function processingRuns(
  frames: () => Iterable<RecordingRecord> | AsyncIterable<RecordingRecord>,
  opts: ProcessingOptions,
  probe: LatencyProbe,
): Promise<ProcessingReplayResult[]> {
  const results: ProcessingReplayResult[] = [];
  for (let rep = 0; rep < opts.repetitions; rep++) {
    const engine = buildBenchEngine({
      strategy: opts.strategy, sink: opts.sink, invalidData: opts.invalidData, probe,
      journal: { latencyMs: opts.journalLatencyMs, failEvery: opts.journalFailEvery || undefined },
    });
    try {
      results.push(await runProcessingReplay(frames(), {
        engine, probe, pacing: opts.pacing, warmupFrames: opts.warmupFrames, deadlineMs: opts.deadlineMs,
        settleMs: opts.journalLatencyMs + 20,
      }));
    } finally {
      engine.stop();
    }
  }
  return results;
}

/**
 * A/A instrumentation-overhead experiment (guide §7): the same input under
 *   disabled — no probe, no observers
 *   counters — frame detail, no trace sampling
 *   sampled  — frame detail with the run's sample probability (the intended config)
 *   stages   — per-event stage spans (diagnostic detail)
 *   full     — stage detail, every trace kept, plus raw frame recording
 * repeated with the configuration order rotated each round so drift does not
 * favour one config.
 */
export async function runOverheadExperiment(
  frames: () => Iterable<RecordingRecord> | AsyncIterable<RecordingRecord>,
  opts: ProcessingOptions,
  runDir: string,
  runId: string,
  workloadLabel: string,
): Promise<OverheadReport> {
  const configs = ["disabled", "counters", "sampled", "stages", "full"] as const;
  const results = new Map<string, OverheadConfigResult>(configs.map((c) => [c, {
    config: c, repetitions: 0, throughput_frames_per_s: [], frame_processing_p99_ms: [], cpu_ms: [], rss_mb_max: [], decision_checksums: [],
  }]));
  const order: string[] = [];
  for (let rep = 0; rep < opts.repetitions; rep++) {
    const rotated = [...configs.slice(rep % configs.length), ...configs.slice(0, rep % configs.length)];
    for (const cfg of rotated) {
      order.push(cfg);
      const probe = cfg === "disabled" ? undefined
        : newProbe(
          `${runId}-aa-${cfg}`,
          cfg === "counters" ? 0 : cfg === "full" ? 1 : opts.sampleProbability,
          opts.deadlineMs,
          cfg === "stages" || cfg === "full" ? "stage" : "frame",
        );
      const recorder = cfg === "full"
        ? new FrameRecorder(path.join(runDir, "aa", `full-rep${rep}`), `${runId}-aa-full-${rep}`, { secretValues: knownSecretValues(), limits: { minFreeBytes: 0 } })
        : null;
      if (recorder) await recorder.open();
      const engine = buildBenchEngine({
        strategy: opts.strategy, sink: opts.sink, invalidData: opts.invalidData, probe,
        observers: recorder ? [recorder] : [],
        journal: { latencyMs: opts.journalLatencyMs },
      });
      const cpu0 = process.cpuUsage();
      let result: ProcessingReplayResult;
      try {
        result = await runProcessingReplay(frames(), {
          engine, probe, pacing: { mode: "max" }, warmupFrames: opts.warmupFrames, settleMs: opts.journalLatencyMs + 20,
        });
      } finally {
        engine.stop();
        if (recorder) await recorder.close();
      }
      const cpu = process.cpuUsage(cpu0);
      const r = results.get(cfg)!;
      r.repetitions++;
      r.throughput_frames_per_s.push(result.throughput_frames_per_s ?? 0);
      r.frame_processing_p99_ms.push(result.frame_processing.p99_ms);
      r.cpu_ms.push((cpu.user + cpu.system) / 1000);
      r.rss_mb_max.push(process.memoryUsage().rss / 1024 / 1024);
      r.decision_checksums.push(String(result.decisions["decision_checksum"]));
    }
  }
  const med = (xs: number[]): number | null => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const base = results.get("disabled")!;
  const baseTp = med(base.throughput_frames_per_s);
  const baseSum = base.decision_checksums[0];
  return {
    workload: workloadLabel,
    order,
    configs: [...results.values()],
    baseline: "disabled",
    gate_throughput_degradation_pct: 5,
    evaluation: [...results.values()].map((r) => {
      const tp = med(r.throughput_frames_per_s);
      return {
        config: r.config,
        median_throughput_degradation_pct: baseTp && tp !== null ? ((baseTp - tp) / baseTp) * 100 : null,
        added_us_per_frame: baseTp && tp ? (1 / tp - 1 / baseTp) * 1e6 : null,
        outputs_equal: r.decision_checksums.every((s) => s === baseSum),
      };
    }),
  };
}

function hashFrames(frames: RecordingRecord[]): string {
  const h = createHash("sha256");
  for (const f of frames) if (f.type === "frame") h.update(`${f.seq}|${f.rx_mono_ns}|${f.data}\n`);
  return h.digest("hex");
}

function emptyMetrics(kind: string, synthetic: boolean, inputLabel: string): MetricsFile {
  return { schema_version: 1, kind, synthetic, input_label: inputLabel, probe: null, replay_runs: [], resources: null, recorder: null, paper: null, notes: [] };
}

/** Writes the standard files for a run and its report. */
export function finishRun(
  artifacts: RunArtifacts,
  manifest: RunManifest,
  metrics: MetricsFile,
  probe?: LatencyProbe,
  monitor?: ResourceMonitor,
): void {
  if (monitor) {
    metrics.resources = monitor.summary();
    artifacts.writeCsv("resource-timeseries.csv", monitor.samples() as unknown as Array<Record<string, unknown>>);
    if (metrics.resources.clock_discontinuities.length) invalidate(manifest, "wall clock stepped during the run (see resources.clock_discontinuities)");
  }
  if (probe) {
    metrics.probe = probe.snapshot();
    artifacts.writeNdjson("trace-sample.ndjson", probe.traceSamples());
  }
  manifest.run["finished_utc"] = new Date().toISOString();
  artifacts.writeJson("manifest.json", manifest);
  artifacts.writeJson("metrics.json", metrics);
  writeReport(artifacts);
}

function artifactsBase(args: Args): string {
  return args.optStr("out") ?? defaultArtifactsBase();
}

// ------------------------------------------------------------------
// fixture
// ------------------------------------------------------------------

export interface FixtureCheck {
  name: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

/** Replays the checked-in fixture and compares the probe's view with EDGE_CASE_EXPECTATIONS. */
export async function runFixtureCorrectness(runId = "fixture-correctness"): Promise<{ passed: boolean; checks: FixtureCheck[]; snapshot: ProbeSnapshot }> {
  const records = buildEdgeCaseFixture();
  const checks: FixtureCheck[] = [];
  const check = (name: string, expected: unknown, actual: unknown): void => {
    checks.push({ name, expected, actual, passed: JSON.stringify(expected) === JSON.stringify(actual) });
  };
  const E = EDGE_CASE_EXPECTATIONS;

  const run = async (invalidData: "pass" | "quarantine"): Promise<{ probe: LatencyProbe; result: ProcessingReplayResult }> => {
    const probe = new LatencyProbe({ runId, detail: "stage", sampleProbability: 1, normalizationVersion: NORMALIZER_VERSION, maxTraceSamples: 10_000 });
    const engine = buildBenchEngine({
      strategy: { name: "quote_imbalance", count: 1, symbols: ["SPY", "QQQ"] }, sink: "sim", invalidData, probe,
    });
    try {
      return { probe, result: await runProcessingReplay(records, { engine, probe, pacing: { mode: "max" } }) };
    } finally {
      engine.stop();
    }
  };

  const { probe, result } = await run("pass");
  const c = (k: string): number => probe.counter(k);
  check("frames received", E.frames, c("frames.received"));
  check("connection epochs", [...E.epochs], result.epochs);
  check("recorded lifecycle records", E.lifecycleRecords, result.lifecycle_records);
  check("parse failures", E.parseFailures, c("frames.parse_failed"));
  for (const [kind, n] of Object.entries(E.events)) check(`${kind} events`, n, c(`events.${kind}`));
  for (const [kind, codes] of Object.entries(E.issues)) {
    for (const [code, n] of Object.entries(codes)) check(`${kind} issue ${code}`, n, c(`issues.${kind}.${code}`));
  }
  for (const [t, n] of Object.entries(E.unhandled)) check(`unhandled ${t}`, n, c(`messages.unhandled.${t}`));
  for (const [k, n] of Object.entries(E.revisions)) check(`revision ${k}`, n, c(`revisions.${k}`));
  for (const t of ["c", "x", "u"]) check(`${t} no longer unhandled`, 0, c(`messages.unhandled.${t}`));
  check("subscription acks", E.subscriptionAcks, c("lifecycle.subscription_ack"));
  check("nothing quarantined under 'pass'", 0, c("quarantined.quote") + c("quarantined.trade"));
  const lag = probe.histogram("bar.publication_lag_ns");
  check("bar publication lag max (ms)", E.barPublicationLagMs, lag?.max === null || lag?.max === undefined ? null : lag.max / 1e6);

  // Sub-millisecond distinction and shared receipt within a frame (frame seq 7 holds the two .199123xxx trades).
  const traces = probe.traceSamples().filter((t) => t.record === "market_event" && t["frame_sequence"] === 7);
  const ns = traces.map((t) => t["provider_epoch_ns"] as string).sort();
  check("sub-ms provider timestamps preserved", "543", ns.length === 2 ? (BigInt(ns[1]) - BigInt(ns[0])).toString() : null);
  check("batched events share one receipt time", 1, new Set(traces.map((t) => t["receive_monotonic_ns"])).size);
  check("sub-ms timestamps exceed Date precision", true,
    parseRfc3339ToEpochNs("2026-03-10T14:30:00.199123456Z") !== parseRfc3339ToEpochNs("2026-03-10T14:30:00.199123999Z"));

  const q = await run("quarantine");
  check("quarantined quotes", E.quarantined.quote, q.probe.counter("quarantined.quote"));
  check("quarantined trades", E.quarantined.trade, q.probe.counter("quarantined.trade"));
  check("issues still counted under quarantine", E.issues.quote.CROSSED_QUOTE, q.probe.counter("issues.quote.CROSSED_QUOTE"));

  const again = await run("pass");
  check("repeat run: identical decisions", result.decisions["decision_checksum"], again.result.decisions["decision_checksum"]);

  return { passed: checks.every((x) => x.passed), checks, snapshot: probe.snapshot() };
}

export async function fixtureCommand(args: Args): Promise<string> {
  const symbols = args.list("symbols", ["SPY", "QQQ"]);
  const workload: SyntheticWorkloadOptions = {
    symbols,
    durationMs: args.num("duration-s", 120, { min: 1, max: 6 * 3600 }) * 1000,
    quotesPerSecPerSymbol: args.num("quote-rate", 50, { min: 0 }),
    tradesPerSecPerSymbol: args.num("trade-rate", 10, { min: 0 }),
    seed: args.num("seed", 42, { integer: true }),
    bursts: parseBursts(args.str("burst", "60000:5000:10")).map((b): BurstSpec => ({ startMs: b.startMs, durationMs: b.durationMs, rateMultiplier: b.multiplier })),
  };
  const opts = processingOptions(args, symbols);
  const skipOverhead = args.bool("skip-overhead");
  const writeRecording = args.bool("write-recording");
  const base = artifactsBase(args);
  args.assertAllUsed();

  const runId = newRunId("fixture");
  const artifacts = RunArtifacts.create(runId, base);
  const manifest = await buildManifest({
    runId, command: "fixture", argv: args.argv, storageDir: artifacts.dir,
    run: {
      mode: "fixture+synthetic", feed: "synthetic (no provider)", symbols, workload,
      strategy: { ...opts.strategy, version: benchStrategyVersion(opts.strategy.name) },
      sink: opts.sink, journal: { latency_ms: opts.journalLatencyMs, fail_every: opts.journalFailEvery },
      pacing: opts.pacing, repetitions: opts.repetitions, warmup_frames: opts.warmupFrames,
      instrumentation: { sample_probability: opts.sampleProbability, detail: opts.detail }, deadline_ms: opts.deadlineMs,
      invalid_data: opts.invalidData, normalizer_version: NORMALIZER_VERSION, step_clock: true,
      broker_orders_submitted: "none (null/simulated sink; fetch disabled)",
    },
  });
  const net = guardNetwork();
  const monitor = new ResourceMonitor();
  monitor.start();
  try {
    console.log(`[bench fixture] ${runId}: correctness on the checked-in fixture…`);
    const correctness = await runFixtureCorrectness(runId);
    artifacts.writeJson("data-quality.json", {
      input: "checked-in edge-case fixture (synthetic)", passed: correctness.passed, checks: correctness.checks,
      counters: correctness.snapshot.counters,
    });
    for (const ch of correctness.checks.filter((x) => !x.passed)) {
      console.error(`  FAIL ${ch.name}: expected ${JSON.stringify(ch.expected)}, got ${JSON.stringify(ch.actual)}`);
    }
    if (!correctness.passed) invalidate(manifest, "fixture correctness checks failed");

    console.log(`[bench fixture] generating synthetic workload (${symbols.join(",")}, ${workload.durationMs / 1000}s, seed ${workload.seed})…`);
    const frames = [...generateSyntheticFrames(workload)];
    manifest.run["input_hash"] = hashFrames(frames);
    manifest.run["input_frames"] = frames.length;
    if (writeRecording) {
      // The synthetic session in the recorder's own format, so replay/delay can be tried without credentials.
      const recorder = new FrameRecorder(artifacts.path("synthetic-recording"), `${runId}-synthetic`, { limits: { minFreeBytes: 0 } });
      await recorder.open();
      for (const f of frames) {
        recorder.onFrame({ epoch: f.epoch, seq: f.seq, rxWallMs: f.rx_wall_ms, rxMonoNs: BigInt(f.rx_mono_ns), text: f.data });
        if (f.seq % 1_000 === 0) await new Promise((r) => setImmediate(r));
      }
      const index = await recorder.close();
      manifest.run["synthetic_recording"] = { dir: "synthetic-recording", complete: index.stats.complete, frames: index.stats.records_written };
    }
    const probe = newProbe(runId, opts.sampleProbability, opts.deadlineMs, opts.detail);
    const metrics = emptyMetrics("fixture", true, `synthetic workload, ${frames.length} frames (seeded)`);
    console.log(`[bench fixture] processing benchmark: ${opts.repetitions} repetition(s), ${opts.pacing.mode} pacing…`);
    metrics.replay_runs = await processingRuns(() => frames, opts, probe);

    if (!skipOverhead) {
      console.log("[bench fixture] A/A instrumentation-overhead experiment…");
      artifacts.writeJson("overhead.json", await runOverheadExperiment(() => frames, opts, artifacts.dir, runId, `synthetic, ${frames.length} frames`));
    }
    monitor.stop();
    manifest.run["network_calls_blocked"] = net.calls();
    finishRun(artifacts, manifest, metrics, probe, monitor);
    if (!correctness.passed) throw new Error(`Fixture correctness failed; see ${artifacts.path("data-quality.json")}`);
  } finally {
    monitor.stop();
    net.restore();
  }
  return artifacts.dir;
}

// ------------------------------------------------------------------
// replay
// ------------------------------------------------------------------

/** Accepts a recording directory or a capture run directory containing recording/. */
export function resolveRecordingDir(p: string): string {
  const candidates = [p, path.join(p, "recording"), path.join(p, "synthetic-recording")];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory() && listSegments(c).length > 0) return c;
  }
  throw new ArgError(`No recording found at ${p} (expected frames-*.ndjson there, in ${p}/recording or in ${p}/synthetic-recording)`);
}

/** Identity of a recording: hash of its index segment hashes, or of the files themselves. */
export async function recordingIdentity(dir: string): Promise<{ hash: string; bytes: number; indexed: boolean }> {
  const files = listSegments(dir);
  const bytes = files.reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
  const indexPath = path.join(dir, RECORDING_INDEX_FILE);
  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as { segments: Array<{ sha256: string }> };
    return { hash: createHash("sha256").update(index.segments.map((s) => s.sha256).join(",")).digest("hex"), bytes, indexed: true };
  }
  const h = createHash("sha256");
  for (const f of files) h.update(await fs.promises.readFile(path.join(dir, f)));
  return { hash: h.digest("hex"), bytes, indexed: false };
}

export async function replayCommand(args: Args): Promise<string> {
  const recordingDir = resolveRecordingDir(args.str("recording"));
  const symbolsArg = args.optStr("symbols");
  const opts = processingOptions(args, symbolsArg ? symbolsArg.split(",") : []);
  const preloadMaxMb = args.num("preload-max-mb", 512, { min: 0 });
  const withOverhead = args.bool("overhead");
  const base = artifactsBase(args);
  args.assertAllUsed();

  const identity = await recordingIdentity(recordingDir);
  // Strategy symbols default to the recording's acknowledged subscription, else what appears in it.
  const report = emptyReadReport();
  const preload = identity.bytes <= preloadMaxMb * 1024 * 1024;
  let loaded: RecordingRecord[] | null = null;
  if (preload) {
    loaded = [];
    for await (const r of readRecording(recordingDir, report)) loaded.push(r);
  }
  if (opts.strategy.symbols.length === 0) {
    const seen = new Set<string>();
    const scan = loaded ?? [];
    for (const r of scan) {
      if (r.type !== "frame") continue;
      try {
        for (const m of JSON.parse(r.data) as Array<Record<string, unknown>>) if (typeof m?.["S"] === "string") seen.add(m["S"] as string);
      } catch { /* skip */ }
      if (seen.size >= 50) break;
    }
    if (seen.size === 0) throw new ArgError("Could not infer symbols from the recording; pass --symbols");
    opts.strategy.symbols = [...seen].sort();
  }

  const runId = newRunId("replay");
  const artifacts = RunArtifacts.create(runId, base);
  const manifest = await buildManifest({
    runId, command: "replay", argv: args.argv, storageDir: artifacts.dir,
    run: {
      mode: "recorded replay", recording_dir: recordingDir, input_hash: identity.hash, input_bytes: identity.bytes,
      input_indexed: identity.indexed, preloaded: preload, symbols: opts.strategy.symbols,
      strategy: { ...opts.strategy, version: benchStrategyVersion(opts.strategy.name) },
      sink: opts.sink, journal: { latency_ms: opts.journalLatencyMs, fail_every: opts.journalFailEvery },
      pacing: opts.pacing, repetitions: opts.repetitions, warmup_frames: opts.warmupFrames,
      instrumentation: { sample_probability: opts.sampleProbability, detail: opts.detail }, deadline_ms: opts.deadlineMs,
      invalid_data: opts.invalidData, normalizer_version: NORMALIZER_VERSION, step_clock: true,
      broker_orders_submitted: "none (null/simulated sink; fetch disabled)",
    },
  });
  if (!identity.indexed) invalidate(manifest, "recording has no recording-index.json (interrupted capture?)");
  const net = guardNetwork();
  const monitor = new ResourceMonitor();
  monitor.start();
  try {
    const frames = (): Iterable<RecordingRecord> | AsyncIterable<RecordingRecord> =>
      loaded ?? readRecording(recordingDir, emptyReadReport());
    const probe = newProbe(runId, opts.sampleProbability, opts.deadlineMs, opts.detail);
    const metrics = emptyMetrics("replay", false, `recording ${path.basename(path.dirname(recordingDir))}/${path.basename(recordingDir)} (${(identity.bytes / 1e6).toFixed(1)} MB)`);
    console.log(`[bench replay] ${runId}: ${opts.repetitions} repetition(s), ${opts.pacing.mode} pacing, strategy ${opts.strategy.name}×${opts.strategy.count}`);
    metrics.replay_runs = await processingRuns(frames, opts, probe);
    if (report.truncatedTail) metrics.notes.push("Recording ends with a truncated record (interrupted capture); it was skipped.");
    if (report.corruptLines) invalidate(manifest, `${report.corruptLines} corrupt line(s) in recording`);
    if (report.hashMismatches.length) invalidate(manifest, `segment hash mismatch: ${report.hashMismatches.join(", ")}`);
    if (metrics.replay_runs.some((r) => r.input_incomplete)) metrics.notes.push("Recording contains gap or redaction records: input is incomplete.");
    if (withOverhead) {
      console.log("[bench replay] A/A instrumentation-overhead experiment…");
      artifacts.writeJson("overhead.json", await runOverheadExperiment(frames, opts, artifacts.dir, runId, `recording ${identity.hash.slice(0, 12)}`));
    }
    monitor.stop();
    manifest.run["network_calls_blocked"] = net.calls();
    finishRun(artifacts, manifest, metrics, probe, monitor);
  } finally {
    monitor.stop();
    net.restore();
  }
  return artifacts.dir;
}

// ------------------------------------------------------------------
// delay
// ------------------------------------------------------------------

export async function delayCommand(args: Args): Promise<string> {
  const planPath = args.str("plan");
  const recordingArg = args.optStr("recording");
  const synthetic = args.bool("synthetic");
  const split = args.choice("split", ["development", "evaluation", "all"] as const, "development");
  const confirmEval = args.bool("confirm-evaluation-split");
  const empiricalFrom = args.optStr("empirical-from");
  const empiricalMetric = args.str("empirical-metric", "order.receive_to_submit_ns");
  const synthOpts = {
    durationMs: args.num("duration-s", 1800, { min: 1 }) * 1000,
    quotesPerSecPerSymbol: args.num("quote-rate", 20, { min: 0 }),
    tradesPerSecPerSymbol: args.num("trade-rate", 5, { min: 0 }),
    seed: args.num("seed", 42, { integer: true }),
  };
  const base = artifactsBase(args);
  args.assertAllUsed();

  if (!!recordingArg === synthetic) throw new ArgError("Pass exactly one of --recording <dir> or --synthetic");
  if (split === "evaluation" && !confirmEval) {
    throw new ArgError("The evaluation split is the untouched hold-out. Pass --confirm-evaluation-split to use it (every use is logged).");
  }
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8")) as DelayPlan;
  validateDelayPlan(plan);
  if (empiricalFrom) {
    const m = JSON.parse(fs.readFileSync(empiricalFrom, "utf8")) as MetricsFile;
    const h = m.probe?.histograms[empiricalMetric];
    if (!h || h.count === 0) throw new ArgError(`${empiricalFrom} has no samples for ${empiricalMetric}`);
    plan.delay_model = { kind: "empirical", samples_ms: samplesFromHistogram(h), source: `${empiricalFrom}#${empiricalMetric}` };
  }
  const planText = JSON.stringify(plan, null, 2);
  const planHash = createHash("sha256").update(planText).digest("hex");

  const runId = newRunId("delay");
  let inputHash: string;
  let inputLabel: string;
  let records: Iterable<RecordingRecord> | AsyncIterable<RecordingRecord>;
  if (recordingArg) {
    const dir = resolveRecordingDir(recordingArg);
    inputHash = (await recordingIdentity(dir)).hash;
    inputLabel = `recording ${dir}`;
    records = readRecording(dir, emptyReadReport());
  } else {
    const frames = [...generateSyntheticFrames({ ...synthOpts, symbols: plan.symbols })];
    inputHash = hashFrames(frames);
    inputLabel = `synthetic session (${synthOpts.durationMs / 1000}s, seed ${synthOpts.seed}) — NOT market data`;
    records = frames;
  }
  const evReport: ObservedEventsReport = { frames: 0, events: 0, rejected: {}, wallClockRegressions: 0 };
  const allEvents = await loadObservedEvents(records, plan.symbols, evReport);
  // Created only once the input is known to be usable, so a failed start leaves nothing behind.
  const artifacts = RunArtifacts.create(runId, base);
  const splits: Array<[string, ObservedEvent[]]> = synthetic
    ? [["synthetic", allEvents]]
    : split === "all"
      ? [["development", sliceByDate(allEvents, plan.splits.development.from, plan.splits.development.to)],
         ["evaluation", sliceByDate(allEvents, plan.splits.evaluation.from, plan.splits.evaluation.to)]]
      : [[split, sliceByDate(allEvents, plan.splits[split].from, plan.splits[split].to)]];

  const manifest = await buildManifest({
    runId, command: "delay", argv: args.argv, storageDir: artifacts.dir,
    run: {
      mode: "strategy delay/cost sensitivity", plan_sha256: planHash, plan_path: planPath, input_hash: inputHash,
      input: inputLabel, symbols: plan.symbols, strategy: { ...plan.strategy, version: benchStrategyVersion(plan.strategy.name) },
      splits: splits.map(([n, e]) => ({ split: n, events: e.length })), events: evReport,
      sink: "delay simulator (no orders)", broker_orders_submitted: "none", deadline_ms: plan.reaction_deadline_ms,
    },
  });
  if (evReport.wallClockRegressions) invalidate(manifest, `wall clock went backwards ${evReport.wallClockRegressions} time(s) in the recording`);
  artifacts.writeText("plan.json", planText + "\n");

  // Log every configuration tested, across runs, next to the run directories.
  const ledgerPath = path.join(base, "delay-ledger.ndjson");
  const priorEvalUses = fs.existsSync(ledgerPath)
    ? fs.readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l["split"] === "evaluation" && l["input_hash"] === inputHash).length
    : 0;
  if (split !== "development" && priorEvalUses > 0) {
    console.warn(`[bench delay] WARNING: the evaluation split of this input has been used ${priorEvalUses} time(s) before; results are no longer out-of-sample.`);
    manifest.run["prior_evaluation_uses"] = priorEvalUses;
  }

  const net = guardNetwork();
  const results: DelayRunResult[] = [];
  const segments: SegmentRow[] = [];
  try {
    for (const [splitName, events] of splits) {
      if (events.length === 0) {
        console.warn(`[bench delay] split ${splitName}: no events in its date range`);
        continue;
      }
      for (const delayMs of plan.delays_ms) {
        for (const cost of plan.cost_scenarios) {
          for (const seed of plan.seeds) {
            const out = simulateDelayRun({ events, plan, split: splitName, delayMs, cost, seed });
            results.push(out.result);
            segments.push(...out.segments);
          }
        }
      }
      console.log(`[bench delay] split ${splitName}: ${events.length} events × ${plan.delays_ms.length} delays × ${plan.cost_scenarios.length} costs × ${plan.seeds.length} seeds`);
    }
  } finally {
    net.restore();
  }
  fs.appendFileSync(ledgerPath, JSON.stringify({
    run_id: runId, created_utc: new Date().toISOString(), plan_sha256: planHash, input_hash: inputHash,
    split: synthetic ? "synthetic" : split, cells: results.length,
  }) + "\n");

  artifacts.writeCsv("delay-cost-results.csv", results as unknown as Array<Record<string, unknown>>);
  artifacts.writeCsv("delay-cost-segments.csv", segments as unknown as Array<Record<string, unknown>>);
  const metrics = emptyMetrics("delay", synthetic, inputLabel);
  metrics.notes.push(`Injected delay = additional ${plan.delay_represents.replace(/_/g, " ")}; the recording's own arrival sequence is the zero baseline.`);
  if (plan.delay_model.kind !== "fixed") metrics.notes.push(`Delay model: ${plan.delay_model.kind}${plan.delay_model.kind === "empirical" ? ` from ${plan.delay_model.source}` : ""}.`);
  finishRun(artifacts, manifest, metrics);
  return artifacts.dir;
}

// ------------------------------------------------------------------
// report / plan-template
// ------------------------------------------------------------------

export function reportCommand(args: Args): string {
  const runDir = args.str("run");
  const compare = args.list("compare", []);
  args.assertAllUsed();
  const run = RunArtifacts.open(runDir);
  writeReport(run);
  if (compare.length) writeComparison(run, compare.map((d) => RunArtifacts.open(d)));
  return run.dir;
}

export function planTemplateCommand(args: Args): string {
  const out = args.str("write");
  args.assertAllUsed();
  if (fs.existsSync(out)) throw new ArgError(`${out} exists; refusing to overwrite a plan`);
  fs.writeFileSync(out, JSON.stringify(delayPlanTemplate(), null, 2) + "\n");
  return out;
}
