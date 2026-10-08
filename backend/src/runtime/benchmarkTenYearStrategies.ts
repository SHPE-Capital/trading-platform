/**
 * Benchmarks ten 10-year runs for each implemented strategy.
 *
 * Results are checkpointed after every run so the benchmark can be resumed.
 * Persistence is intentionally skipped: this measures historical-data loading
 * plus simulation, not Supabase write time.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { BacktestEngine } from "../core/backtest/backtestEngine";
import { PairsStrategy } from "../strategies/pairs/pairsStrategy";
import { createPairsConfig } from "../strategies/pairs/pairsConfig";
import { AvellanedaStoikovStrategy } from "../strategies/marketMaking/avellanedaStoikovStrategy";
import { createAvellanedaStoikovConfig } from "../strategies/marketMaking/avellanedaStoikovConfig";
import { newId } from "../utils/ids";
import type { BacktestConfig } from "../types/backtest";
import type { IStrategy } from "../strategies/base/strategy";

type StrategyName = "pairs_trading" | "avellaneda_stoikov";

interface RunDefinition {
  key: string;
  strategy: StrategyName;
  symbols: string[];
}

interface RunSummary extends RunDefinition {
  status: "completed" | "failed";
  durationMs: number;
  bars?: number;
  orders?: number;
  fills?: number;
  trades?: number;
  error?: string;
}

interface Aggregate {
  strategy: StrategyName | "combined";
  completedRuns: number;
  failedRuns: number;
  averageDurationMs: number;
  averageBars: number;
  totalDurationMs: number;
  totalBars: number;
}

interface BenchmarkCheckpoint {
  commitDescription: string;
  period: { startDate: string; endDate: string };
  startedAt: string;
  updatedAt: string;
  runs: RunSummary[];
  aggregates?: Aggregate[];
}

const START_DATE = "2016-01-01T00:00:00Z";
const END_DATE = "2025-12-31T23:59:59Z";
const OUTPUT_PATH = join(tmpdir(), "shpe-capital-ten-year-strategy-benchmark-v1.json");

const definitions: RunDefinition[] = [
  { key: "pairs-01", strategy: "pairs_trading", symbols: ["SPY", "QQQ"] },
  { key: "pairs-02", strategy: "pairs_trading", symbols: ["XOM", "CVX"] },
  { key: "pairs-03", strategy: "pairs_trading", symbols: ["KO", "PEP"] },
  { key: "pairs-04", strategy: "pairs_trading", symbols: ["JPM", "BAC"] },
  { key: "pairs-05", strategy: "pairs_trading", symbols: ["HD", "LOW"] },
  { key: "pairs-06", strategy: "pairs_trading", symbols: ["V", "MA"] },
  { key: "pairs-07", strategy: "pairs_trading", symbols: ["WMT", "TGT"] },
  { key: "pairs-08", strategy: "pairs_trading", symbols: ["UPS", "FDX"] },
  { key: "pairs-09", strategy: "pairs_trading", symbols: ["CAT", "DE"] },
  { key: "pairs-10", strategy: "pairs_trading", symbols: ["GS", "MS"] },
  { key: "as-01", strategy: "avellaneda_stoikov", symbols: ["AAPL"] },
  { key: "as-02", strategy: "avellaneda_stoikov", symbols: ["MSFT"] },
  { key: "as-03", strategy: "avellaneda_stoikov", symbols: ["AMZN"] },
  { key: "as-04", strategy: "avellaneda_stoikov", symbols: ["GOOGL"] },
  { key: "as-05", strategy: "avellaneda_stoikov", symbols: ["META"] },
  { key: "as-06", strategy: "avellaneda_stoikov", symbols: ["NVDA"] },
  { key: "as-07", strategy: "avellaneda_stoikov", symbols: ["ORCL"] },
  { key: "as-08", strategy: "avellaneda_stoikov", symbols: ["IBM"] },
  { key: "as-09", strategy: "avellaneda_stoikov", symbols: ["DIS"] },
  { key: "as-10", strategy: "avellaneda_stoikov", symbols: ["NKE"] },
];

function loadCheckpoint(): BenchmarkCheckpoint {
  if (existsSync(OUTPUT_PATH)) {
    return JSON.parse(readFileSync(OUTPUT_PATH, "utf8")) as BenchmarkCheckpoint;
  }
  const now = new Date().toISOString();
  return {
    commitDescription: "origin/main@7aa3bb6",
    period: { startDate: START_DATE, endDate: END_DATE },
    startedAt: now,
    updatedAt: now,
    runs: [],
  };
}

function saveCheckpoint(checkpoint: BenchmarkCheckpoint): void {
  checkpoint.updatedAt = new Date().toISOString();
  writeFileSync(OUTPUT_PATH, JSON.stringify(checkpoint, null, 2) + "\n", "utf8");
}

function buildRun(definition: RunDefinition): {
  config: BacktestConfig;
  factory: () => IStrategy[];
} {
  if (definition.strategy === "pairs_trading") {
    const strategyConfig = createPairsConfig(definition.symbols[0], definition.symbols[1]);
    return {
      config: {
        id: newId(),
        name: `Benchmark ${definition.key}: ${definition.symbols.join("/")}`,
        strategyConfig,
        startDate: START_DATE,
        endDate: END_DATE,
        initialCapital: 100_000,
        dataGranularity: "bar",
        slippageBps: 5,
        commissionPerShare: 0.005,
      },
      factory: () => [new PairsStrategy(strategyConfig)],
    };
  }

  const strategyConfig = createAvellanedaStoikovConfig(definition.symbols[0], "balanced");
  return {
    config: {
      id: newId(),
      name: `Benchmark ${definition.key}: ${definition.symbols[0]}`,
      strategyConfig: strategyConfig as never,
      startDate: START_DATE,
      endDate: END_DATE,
      initialCapital: 100_000,
      dataGranularity: "bar",
      slippageBps: 5,
      commissionPerShare: 0.005,
    },
    factory: () => [new AvellanedaStoikovStrategy(strategyConfig)],
  };
}

function aggregate(runs: RunSummary[], strategy: Aggregate["strategy"]): Aggregate {
  const selected = strategy === "combined" ? runs : runs.filter((run) => run.strategy === strategy);
  const completed = selected.filter((run) => run.status === "completed" && run.bars != null);
  const totalDurationMs = completed.reduce((sum, run) => sum + run.durationMs, 0);
  const totalBars = completed.reduce((sum, run) => sum + (run.bars ?? 0), 0);
  return {
    strategy,
    completedRuns: completed.length,
    failedRuns: selected.length - completed.length,
    averageDurationMs: completed.length > 0 ? totalDurationMs / completed.length : 0,
    averageBars: completed.length > 0 ? totalBars / completed.length : 0,
    totalDurationMs,
    totalBars,
  };
}

async function main(): Promise<void> {
  const checkpoint = loadCheckpoint();
  const completedKeys = new Set(checkpoint.runs.map((run) => run.key));
  console.log(JSON.stringify({ event: "benchmark_start", outputPath: OUTPUT_PATH, completed: completedKeys.size }));

  for (const definition of definitions) {
    if (completedKeys.has(definition.key)) {
      console.log(JSON.stringify({ event: "skip", key: definition.key }));
      continue;
    }

    console.log(JSON.stringify({ event: "run_start", ...definition, at: new Date().toISOString() }));
    const started = performance.now();
    let summary: RunSummary;
    try {
      const { config, factory } = buildRun(definition);
      const engine = new BacktestEngine();
      const result = await engine.run(config, factory);
      summary = {
        ...definition,
        status: "completed",
        durationMs: performance.now() - started,
        bars: result.event_count,
        orders: result.orders?.length ?? 0,
        fills: result.fills?.length ?? 0,
        trades: result.metrics.totalTrades,
      };
    } catch (error) {
      summary = {
        ...definition,
        status: "failed",
        durationMs: performance.now() - started,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      };
    }

    checkpoint.runs.push(summary);
    checkpoint.aggregates = [
      aggregate(checkpoint.runs, "pairs_trading"),
      aggregate(checkpoint.runs, "avellaneda_stoikov"),
      aggregate(checkpoint.runs, "combined"),
    ];
    saveCheckpoint(checkpoint);
    console.log(JSON.stringify({ event: "run_complete", ...summary }));

    if (global.gc) global.gc();
  }

  console.log(JSON.stringify({ event: "benchmark_complete", outputPath: OUTPUT_PATH, aggregates: checkpoint.aggregates }));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "benchmark_fatal", error: String(error) }));
  process.exit(1);
});
