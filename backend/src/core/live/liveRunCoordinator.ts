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
  /** Called with symbols no held run needs anymore, so the feed stops sending them. */
  unsubscribe(symbols: string[]): void;
  leases: LeaseStore;
  buildStrategy(run: StrategyRun): IStrategy;
  warmUp(strategy: IStrategy): Promise<number>;
  markRunErrored(runId: string, reason: string): Promise<void>;
  markRunExpired(runId: string, reason: string): Promise<void>;
  /**
   * Re-applies an adopted run's persisted fills to the in-memory book, so a
   * strategy that sizes or caps by position resumes with what it actually
   * holds instead of believing it is flat. Returns fills applied. Omitted,
   * adopted runs start from an empty book.
   */
  restorePositions?(run: StrategyRun): Promise<number>;
  /** Broker account this runner trades; stamped on every run it inserts. */
  brokerAccount?: string;
  now?: () => number;
}

export class LiveRunCoordinator {
  private readonly held = new Set<string>();
  private readonly expirations = new Map<string, number>();
  /** Symbols each held run subscribed, so a stop releases only what nothing else uses. */
  private readonly runSymbols = new Map<string, string[]>();
  /**
   * Runs whose fills are already in this process's book. A run that is lost
   * and later re-adopted here is not restored twice; fills another runner made
   * for it in between are not picked up either (the book is per process).
   */
  private readonly restored = new Set<string>();
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

  /**
   * Ownership columns for a run this runner is about to insert itself: the
   * lease, and the broker account the run will trade.
   */
  leaseFields(): { leaseOwner: string; leaseExpiresAt: number; brokerAccount?: string } {
    return {
      leaseOwner: this.owner,
      leaseExpiresAt: this.now() + this.leaseSeconds * 1000,
      ...(this.deps.brokerAccount ? { brokerAccount: this.deps.brokerAccount } : {}),
    };
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
  activate(runId: string, strategy: IStrategy, expiresAt?: number | null): void {
    this.deps.registry.registerStrategy(strategy, runId);
    const symbols = strategy.config.symbols ?? [];
    // What is actually running, so a member can confirm it matches what they meant to launch.
    logger.info("LiveRunCoordinator: run activated", {
      runId,
      name: strategy.config.name,
      type: strategy.type,
      algorithmVersion: strategy.version,
      symbols,
      decidesOn: strategy.triggers ?? "every quote, trade and bar",
    });
    if (symbols.length === 0) {
      logger.warn("LiveRunCoordinator: run has no symbols, so it will never receive market data", {
        runId, name: strategy.config.name,
      });
    }
    if (symbols.length > 0) this.deps.subscribe(symbols);
    this.runSymbols.set(runId, [...new Set(symbols)]);
    this.held.add(runId);
    if (expiresAt) this.expirations.set(runId, expiresAt);
  }

  /** Stops trading a run and gives its lease back. */
  async deactivate(runId: string): Promise<void> {
    this.deps.registry.deregisterStrategy(runId);
    if (!this.held.delete(runId)) return;
    this.expirations.delete(runId);
    this.releaseSymbols(runId);
    await this.deps.leases.release(runId).catch((err) =>
      logger.warn("LiveRunCoordinator: lease release failed — it will lapse on its own", { runId, err: String(err) }),
    );
  }

  /** Drops a run locally without touching its lease row (e.g. its insert never landed). */
  forget(runId: string): void {
    this.deps.registry.deregisterStrategy(runId);
    this.held.delete(runId);
    this.expirations.delete(runId);
    this.releaseSymbols(runId);
  }

  isHeld(runId: string): boolean {
    return this.held.has(runId);
  }

  heldRuns(): string[] {
    return [...this.held];
  }

  /** One maintenance cycle: heartbeat held leases, then adopt orphans. */
  async tick(): Promise<{ lost: string[]; adopted: string[]; expired: string[] }> {
    const expired = await this.expireDueRuns();
    const lost = await this.heartbeat();
    const adopted = await this.adoptOrphans();
    return { lost, adopted, expired };
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
        if (run.strategyVersion !== undefined && strategy.version !== run.strategyVersion) {
          throw new Error(
            `Algorithm changed from v${run.strategyVersion} (when this run started) to v${strategy.version} ` +
            "in the deployed code; start a new paper sandbox, or re-approve for real money",
          );
        }
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
      if (this.deps.restorePositions && !this.restored.has(run.id)) {
        try {
          const fills = await this.deps.restorePositions(run);
          this.restored.add(run.id);
          if (fills > 0) logger.info("LiveRunCoordinator: restored run positions from its fills", { runId: run.id, fills });
        } catch (err) {
          // Trading on a book missing this run's holdings could breach its
          // position limits. Hand the lease back; the next tick retries.
          logger.error("LiveRunCoordinator: could not restore run positions — not adopting it yet", {
            runId: run.id, err: String(err),
          });
          await this.deps.leases.release(run.id).catch(() => false);
          continue;
        }
      }
      await this.prepare(strategy);
      this.activate(run.id, strategy, run.expiresAt);
      adopted.push(run.id);
      logger.info("LiveRunCoordinator: adopted run", { runId: run.id, strategyType: run.strategyType });
    }
    return adopted;
  }

  /** Gives back every lease — graceful shutdown, so a successor adopts at once. */
  async releaseAll(): Promise<void> {
    const runIds = [...this.held];
    this.held.clear();
    this.expirations.clear();
    this.runSymbols.clear();
    await Promise.all(runIds.map((id) => this.deps.leases.release(id).catch(() => false)));
  }

  private async expireDueRuns(): Promise<string[]> {
    const expired = [...this.expirations.entries()]
      .filter(([, expiresAt]) => expiresAt <= this.now())
      .map(([runId]) => runId);
    for (const runId of expired) {
      const reason = "Paper sandbox run expired";
      try {
        await this.deps.markRunExpired(runId, reason);
      } catch (err) {
        logger.error("LiveRunCoordinator: could not persist sandbox expiry — retaining lease", {
          runId, err: String(err),
        });
        continue;
      }
      await this.deactivate(runId);
      logger.info("LiveRunCoordinator: sandbox expired", { runId });
    }
    return expired.filter((runId) => !this.held.has(runId));
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

  /** Unsubscribes a dropped run's symbols that no other held run still trades. */
  private releaseSymbols(runId: string): void {
    const symbols = this.runSymbols.get(runId);
    if (!this.runSymbols.delete(runId) || !symbols) return;
    const stillUsed = new Set([...this.runSymbols.values()].flat());
    const unused = symbols.filter((s) => !stillUsed.has(s));
    if (unused.length > 0) this.deps.unsubscribe(unused);
  }
}
