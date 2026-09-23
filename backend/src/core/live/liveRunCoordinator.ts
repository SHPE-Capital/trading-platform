/**
 * core/live/liveRunCoordinator.ts
 *
 * Owns which strategy runs this trading process is allowed to trade (Part 05).
 * The live book is single-writer: two runners submitting the same signals to
 * one Alpaca account would each reserve the same cash and overcommit it. So a
 * runner trades a run only while it holds that run's lease, and:
 *
 *   - heartbeats every held lease; a run whose lease comes back missing was
 *     adopted by another runner and is dropped here immediately;
 *   - adopts running runs of its own execution mode whose lease is missing or
 *     lapsed (boot, a crashed peer, a finished rolling deploy);
 *   - fences itself — stops trading everything — when it cannot reach the
 *     database long enough that its leases may have lapsed, because another
 *     runner is then free to adopt them.
 *
 * Every strategy is warmed from history before it trades, so a restart does not
 * leave rolling windows below minObservations for days.
 */

import { logger } from "../../utils/logger";
import type { IStrategy } from "../../strategies/base/strategy";
import type { StrategyRun } from "../../types/strategy";

export interface RunRegistry {
  registerStrategy(strategy: IStrategy, runId?: string): void;
  deregisterStrategy(runId: string): boolean;
}

export interface LeaseStore {
  claimOrphans(): Promise<StrategyRun[]>;
  heartbeat(runIds: string[]): Promise<string[]>;
  release(runId: string): Promise<boolean>;
}

export interface LiveRunCoordinatorDeps {
  registry: RunRegistry;
  subscribe(symbols: string[]): void;
  leases: LeaseStore;
  buildStrategy(run: StrategyRun): IStrategy;
  warmUp(strategy: IStrategy): Promise<number>;
  markRunErrored(runId: string, reason: string): Promise<void>;
  now?: () => number;
}

export class LiveRunCoordinator {
  private readonly held = new Set<string>();
  private lastHeartbeatOkAt: number;
  private readonly now: () => number;

  constructor(
    readonly owner: string,
    readonly leaseSeconds: number,
    private readonly deps: LiveRunCoordinatorDeps,
  ) {
    this.now = deps.now ?? Date.now;
    this.lastHeartbeatOkAt = this.now();
  }

  /** Lease columns for a run this runner is about to insert itself. */
  leaseFields(): { leaseOwner: string; leaseExpiresAt: number } {
    return { leaseOwner: this.owner, leaseExpiresAt: this.now() + this.leaseSeconds * 1000 };
  }

  /** Primes a strategy from history. Never throws — a cold start beats no start. */
  async prepare(strategy: IStrategy): Promise<void> {
    try {
      const primed = await this.deps.warmUp(strategy);
      if (primed > 0) logger.info("LiveRunCoordinator: strategy warmed up", { strategyId: strategy.id, primed });
    } catch (err) {
      logger.warn("LiveRunCoordinator: warm-up failed — strategy starts cold", {
        strategyId: strategy.id, err: String(err),
      });
    }
  }

  /** Starts trading a run this runner holds the lease on. */
  activate(runId: string, strategy: IStrategy): void {
    this.deps.registry.registerStrategy(strategy, runId);
    const symbols = strategy.config.symbols ?? [];
    if (symbols.length > 0) this.deps.subscribe(symbols);
    this.held.add(runId);
  }

  /** Stops trading a run and gives its lease back. */
  async deactivate(runId: string): Promise<void> {
    this.deps.registry.deregisterStrategy(runId);
    if (!this.held.delete(runId)) return;
    await this.deps.leases.release(runId).catch((err) =>
      logger.warn("LiveRunCoordinator: lease release failed — it will lapse on its own", { runId, err: String(err) }),
    );
  }

  /** Drops a run locally without touching its lease row (e.g. its insert never landed). */
  forget(runId: string): void {
    this.deps.registry.deregisterStrategy(runId);
    this.held.delete(runId);
  }

  isHeld(runId: string): boolean {
    return this.held.has(runId);
  }

  heldRuns(): string[] {
    return [...this.held];
  }

  /** One maintenance cycle: heartbeat held leases, then adopt orphans. */
  async tick(): Promise<{ lost: string[]; adopted: string[] }> {
    const lost = await this.heartbeat();
    const adopted = await this.adoptOrphans();
    return { lost, adopted };
  }

  /** Claims and starts every orphaned running run of this runner's mode. */
  async adoptOrphans(): Promise<string[]> {
    let runs: StrategyRun[];
    try {
      runs = await this.deps.leases.claimOrphans();
    } catch (err) {
      logger.warn("LiveRunCoordinator: orphan claim failed", { err: String(err) });
      return [];
    }

    const adopted: string[] = [];
    for (const run of runs) {
      if (this.held.has(run.id)) continue;
      let strategy: IStrategy;
      try {
        strategy = this.deps.buildStrategy(run);
      } catch (err) {
        // Unbuildable config (unknown type, bad JSON). Every runner would fail
        // the same way, so park it visibly instead of re-claiming it forever.
        logger.error("LiveRunCoordinator: cannot rebuild strategy for run — marking it errored", {
          runId: run.id, err: String(err),
        });
        await this.deps.markRunErrored(run.id, `Could not be resumed: ${String(err)}`).catch(() => {});
        await this.deps.leases.release(run.id).catch(() => false);
        continue;
      }
      await this.prepare(strategy);
      this.activate(run.id, strategy);
      adopted.push(run.id);
      logger.info("LiveRunCoordinator: adopted run", { runId: run.id, strategyType: run.strategyType });
    }
    return adopted;
  }

  /** Gives back every lease — graceful shutdown, so a successor adopts at once. */
  async releaseAll(): Promise<void> {
    const runIds = [...this.held];
    this.held.clear();
    await Promise.all(runIds.map((id) => this.deps.leases.release(id).catch(() => false)));
  }

  private async heartbeat(): Promise<string[]> {
    const runIds = [...this.held];
    if (runIds.length === 0) {
      this.lastHeartbeatOkAt = this.now();
      return [];
    }

    let stillHeld: Set<string>;
    try {
      stillHeld = new Set(await this.deps.leases.heartbeat(runIds));
      this.lastHeartbeatOkAt = this.now();
    } catch (err) {
      // Past most of the lease without a successful heartbeat, another runner
      // may already hold these runs. Stop trading them rather than risk two
      // writers on one account; adoption resumes them once the DB is back.
      const silentMs = this.now() - this.lastHeartbeatOkAt;
      if (silentMs >= this.leaseSeconds * 1000 * 0.8) {
        logger.error("LiveRunCoordinator: lease heartbeats failing past the safety margin — fencing all runs", {
          silentMs, runs: runIds.length, err: String(err),
        });
        for (const id of runIds) this.forget(id);
        return runIds;
      }
      logger.warn("LiveRunCoordinator: heartbeat failed, retrying next tick", { silentMs, err: String(err) });
      return [];
    }

    const lost = runIds.filter((id) => !stillHeld.has(id));
    for (const id of lost) {
      logger.error("LiveRunCoordinator: lease lost — another runner owns this run now; stopped trading it", { runId: id });
      this.forget(id);
    }
    return lost;
  }
}
