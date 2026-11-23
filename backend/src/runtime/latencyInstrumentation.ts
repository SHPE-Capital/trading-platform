/**
 * runtime/latencyInstrumentation.ts
 *
 * Opt-in latency instrumentation for a trading runtime (LATENCY_PROBE=1).
 * This is how live measurements attach to the EXISTING market-data stream
 * owner instead of opening a second connection: the runtime's own adapter,
 * orchestrator, journal and broker sink report to one probe, and a timer
 * exports metrics.json to a run directory. LATENCY_RECORD=1 additionally
 * records the runtime's inbound frames for later replay.
 *
 * It only observes. Order flow, risk checks, journaling and the broker call
 * are unchanged; decorators re-throw every error they see.
 *
 * Inputs:  env LATENCY_* settings; runtime components wired by bootstrap.
 * Output directory: LATENCY_PROBE_DIR (must not exist yet), else a new
 * <artifacts>/latency/<run-id>/ (see defaultArtifactsBase).
 * Outputs: <dir>/manifest.json, metrics.json (refreshed), trace-sample.ndjson,
 *          resource-timeseries.csv, recording/ and decision-report.md at stop.
 */

import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { LatencyProbe } from "../core/telemetry/latencyProbe";
import { ResourceMonitor } from "../core/telemetry/resourceMonitor";
import { FrameRecorder } from "../core/telemetry/frameRecorder";
import { TimedExecutionSink, TimedOrderJournal, attachOrderLifecycle } from "../core/telemetry/orderPathTiming";
import { NORMALIZER_VERSION } from "../adapters/alpaca/normalizer";
import { RunArtifacts, defaultArtifactsBase, knownSecretValues, newRunId } from "../bench/artifacts";
import { buildManifest } from "../bench/manifest";
import { finishRun } from "../bench/commands";
import { logger } from "../utils/logger";
import type { EventBus } from "../core/engine/eventBus";
import type { IExecutionSink } from "../core/execution/IExecutionSink";
import type { OrderJournal } from "../core/execution/journaledExecution";
import type { MarketDataAdapterOptions } from "../adapters/alpaca/marketData";
import type { OrderExecutionAdapterOptions } from "../adapters/alpaca/orderExecution";
import type { MetricsFile } from "../bench/report";
import type { RunManifest } from "../bench/manifest";

export class RuntimeLatency {
  readonly probe: LatencyProbe;
  private readonly monitor = new ResourceMonitor();
  private recorder: FrameRecorder | null = null;
  private artifacts: RunArtifacts | null = null;
  private manifest: RunManifest | null = null;
  private exportTimer: NodeJS.Timeout | null = null;
  private detach: (() => void) | null = null;

  constructor(private readonly mode: string, private readonly target: string) {
    this.probe = new LatencyProbe({
      runId: newRunId(`runtime-${mode}`),
      detail: env.latencyProbeDetail === "stage" ? "stage" : "frame",
      sampleProbability: env.latencyProbeSample,
      normalizationVersion: NORMALIZER_VERSION,
      deadlinesMs: { "order.receive_to_submit_ns": 10, "frame.receive_to_done_ns": 10 },
    });
  }

  /** Creates the run directory, manifest and (optionally) the recorder. Never throws: instrumentation must not stop trading. */
  async prepare(): Promise<void> {
    try {
      const runId = this.probe.runId;
      const base = env.latencyProbeDir ? path.dirname(path.resolve(env.latencyProbeDir)) : defaultArtifactsBase();
      const name = env.latencyProbeDir ? path.basename(path.resolve(env.latencyProbeDir)) : runId;
      this.artifacts = RunArtifacts.create(name, base);
      this.manifest = await buildManifest({
        runId, command: "runtime", argv: [], storageDir: this.artifacts.dir,
        run: {
          mode: `instrumented ${this.mode} runtime (existing stream owner)`, execution_target: this.target,
          feed: env.alpacaDataStreamUrl, instrumentation: { sample_probability: env.latencyProbeSample, detail: env.latencyProbeDetail },
          recording: env.latencyRecord ? { max_mb: env.latencyRecordMaxMb } : "disabled",
          sink: this.target === "sim" ? "simulated (local)" : `Alpaca ${this.target}`,
          broker_orders_submitted: this.target === "sim" ? "none (sim target)" : "whatever the running strategies send — instrumentation does not add orders",
        },
      });
      if (env.latencyRecord) {
        this.recorder = new FrameRecorder(this.artifacts.path("recording"), runId, {
          secretValues: knownSecretValues(),
          limits: { maxTotalBytes: env.latencyRecordMaxMb * 1024 * 1024 },
        });
        await this.recorder.open();
      }
      logger.info("latency instrumentation: enabled", { dir: this.artifacts.dir, record: !!this.recorder, detail: env.latencyProbeDetail });
    } catch (err) {
      logger.error("latency instrumentation: setup failed — continuing without artifacts", { err: String(err) });
    }
  }

  adapterOptions(): MarketDataAdapterOptions {
    return { probe: this.probe, observers: this.recorder ? [this.recorder] : [] };
  }

  /** Hooks for the Alpaca order adapter (response-header timing). */
  orderAdapterOptions(): OrderExecutionAdapterOptions {
    return { onResponseHeaders: (intentId, ns) => this.probe.responseHeaders(intentId, ns) };
  }

  wrapSink(sink: IExecutionSink): IExecutionSink {
    return new TimedExecutionSink(sink, this.probe);
  }

  wrapJournal(journal: OrderJournal): OrderJournal {
    return new TimedOrderJournal(journal, this.probe);
  }

  /** Call after Orchestrator.start() so fills are observed after they are applied. */
  start(bus: EventBus): void {
    this.detach = attachOrderLifecycle(bus, this.probe);
    this.monitor.start();
    this.exportTimer = setInterval(() => this.export(), Math.max(10, env.latencyProbeExportSeconds) * 1000);
    this.exportTimer.unref?.();
  }

  /** Writes the current metrics (overwrites metrics.json). Best effort. */
  export(): void {
    if (!this.artifacts) return;
    try {
      const tmp = this.artifacts.path("metrics.json.tmp");
      this.artifacts.writeJson("metrics.json.tmp", this.metricsFile());
      fs.renameSync(tmp, this.artifacts.path("metrics.json"));
    } catch (err) {
      logger.warn("latency instrumentation: export failed", { err: String(err) });
    }
  }

  async stop(): Promise<void> {
    if (this.exportTimer) clearInterval(this.exportTimer);
    this.detach?.();
    this.monitor.stop();
    const metrics = this.metricsFile();
    try {
      if (this.recorder) metrics.recorder = (await this.recorder.close()).stats;
      if (this.artifacts && this.manifest) finishRun(this.artifacts, this.manifest, metrics, this.probe, this.monitor);
    } catch (err) {
      logger.warn("latency instrumentation: final write failed", { err: String(err) });
    }
  }

  private metricsFile(): MetricsFile {
    return {
      schema_version: 1, kind: "runtime", synthetic: false,
      input_label: `live ${this.mode} runtime (${this.target})`,
      probe: this.probe.snapshot(), replay_runs: [], resources: this.monitor.summary(),
      recorder: this.recorder?.stats() ?? null, paper: null,
      notes: ["Measured inside the trading runtime on its own data stream; order timings cover whatever the running strategies sent."],
    };
  }
}
