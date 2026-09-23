/**
 * runtime/backtestWorker.ts
 *
 * Backtest worker entry point (Part 02). Claims jobs from backtest_jobs and runs
 * them with the shared bar cache (Part 03). Holds no broker connection and no
 * live state — it is the sandbox side of the topology, so the simulated clock
 * a backtest installs can never reach a trading process.
 *
 * Run as many as CPU allows; each processes one job at a time.
 *
 * Optional env:
 *   BACKTEST_WORKER_LEASE_SECONDS=60   job lease; heartbeats run every quarter of it
 *   BACKTEST_PER_USER_CAP=2            concurrently running jobs per member
 *   BACKTEST_MAX_ATTEMPTS=3            lease expiries before a job is failed as poison
 *   BACKTEST_RESULT_TTL_SECONDS=1800   how long an unsaved result stays saveable
 *
 * Start with: npm run dev:worker (dev) · npm run start:worker (prod)
 */

import os from "os";
import { randomBytes } from "crypto";
import { BacktestWorker } from "../core/backtest/backtestWorker";
import { BacktestEngine } from "../core/backtest/backtestEngine";
import { BacktestLoader } from "../core/backtest/backtestLoader";
import { buildBacktestStrategies } from "../core/backtest/strategyFactory";
import { SupabaseBarCache } from "../adapters/supabase/barCacheRepository";
import {
  claimBacktestJob,
  touchBacktestJob,
  writeJobArtifacts,
  completeBacktestJob,
  failBacktestJob,
  releaseBacktestJob,
  sweepBacktestJobs,
} from "../adapters/supabase/backtestJobRepository";
import { logger } from "../utils/logger";

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const LEASE_SECONDS = intEnv("BACKTEST_WORKER_LEASE_SECONDS", 60);
const PER_USER_CAP = intEnv("BACKTEST_PER_USER_CAP", 2);
const MAX_ATTEMPTS = intEnv("BACKTEST_MAX_ATTEMPTS", 3);
const RESULT_TTL_SECONDS = intEnv("BACKTEST_RESULT_TTL_SECONDS", 1800);
/** Finished job rows (and any unsaved staging they still hold) are kept this long. */
const KEEP_FINISHED_HOURS = 72;

async function main(): Promise<void> {
  const workerId = `worker:${os.hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
  const barCache = new SupabaseBarCache();

  const worker = new BacktestWorker(
    workerId,
    {
      claim: (id) =>
        claimBacktestJob(id, { leaseSeconds: LEASE_SECONDS, maxAttempts: MAX_ATTEMPTS, perUserCap: PER_USER_CAP }),
      touch: (jobId, id, progress) => touchBacktestJob(jobId, id, LEASE_SECONDS, progress),
      writeArtifacts: writeJobArtifacts,
      complete: (jobId, id) => completeBacktestJob(jobId, id, RESULT_TTL_SECONDS),
      fail: failBacktestJob,
      release: releaseBacktestJob,
      sweep: () => sweepBacktestJobs(KEEP_FINISHED_HOURS),
    },
    () => new BacktestEngine(new BacktestLoader({ cache: barCache })),
    buildBacktestStrategies,
    {
      heartbeatMs: Math.max(1_000, Math.floor((LEASE_SECONDS * 1000) / 4)),
      progressMs: 1_000,
      pollMs: 2_000,
      sweepMs: 5 * 60_000,
    },
  );

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn(`runtime/backtestWorker: ${signal} — returning any in-flight job to the queue`);
    worker.stop().then(() => process.exit(0), () => process.exit(1));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.info("runtime/backtestWorker: starting", { workerId, leaseSeconds: LEASE_SECONDS, perUserCap: PER_USER_CAP });
  await worker.start();
}

main().catch((err) => {
  logger.error("runtime/backtestWorker: fatal error", { err });
  process.exit(1);
});
