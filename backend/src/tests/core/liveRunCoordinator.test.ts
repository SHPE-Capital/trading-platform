jest.mock('../../config/env', () => ({ env: { logLevel: 'error' } }));

import { LiveRunCoordinator, type LiveRunCoordinatorDeps } from '../../core/live/liveRunCoordinator';
import type { IStrategy } from '../../strategies/base/strategy';
import type { StrategyRun } from '../../types/strategy';

function run(id: string, overrides: Partial<StrategyRun> = {}): StrategyRun {
  return {
    id,
    strategyId: `strat-${id}`,
    strategyType: 'pairs_trading',
    name: `Run ${id}`,
    config: { symbols: ['XOM', 'CVX'] } as unknown as StrategyRun['config'],
    status: 'running',
    executionMode: 'paper',
    totalSignals: 0,
    totalOrders: 0,
    realizedPnl: 0,
    ...overrides,
  };
}

function strategyFor(r: StrategyRun): IStrategy {
  return { id: r.strategyId, config: { symbols: ['XOM', 'CVX'] } } as unknown as IStrategy;
}

function setup(overrides: Partial<Record<'buildStrategy' | 'warmUp', jest.Mock>> = {}, now = { t: 1_000_000 }) {
  const registered = new Map<string, IStrategy>();
  const deps = {
    registry: {
      registerStrategy: jest.fn((s: IStrategy, id?: string) => { registered.set(id!, s); }),
      deregisterStrategy: jest.fn((id: string) => registered.delete(id)),
    },
    subscribe: jest.fn(),
    leases: {
      claimOrphans: jest.fn(async (): Promise<StrategyRun[]> => []),
      heartbeat: jest.fn(async (ids: string[]): Promise<string[]> => ids),
      release: jest.fn(async () => true),
    },
    buildStrategy: overrides.buildStrategy ?? jest.fn(strategyFor),
    warmUp: overrides.warmUp ?? jest.fn(async () => 42),
    markRunErrored: jest.fn(async () => {}),
    markRunExpired: jest.fn(async () => {}),
    now: () => now.t,
  };
  const coordinator = new LiveRunCoordinator('paper:host:1:abc', 90, deps as unknown as LiveRunCoordinatorDeps);
  return { coordinator, deps, registered, now };
}

describe('LiveRunCoordinator: position restore on adoption', () => {
  it("re-applies an adopted run's fills before it trades", async () => {
    const { coordinator, deps, registered } = setup();
    const restorePositions = jest.fn(async () => 9);
    Object.assign(deps, { restorePositions });
    deps.leases.claimOrphans.mockResolvedValue([run('r1')]);

    await coordinator.adoptOrphans();

    expect(restorePositions).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    expect(restorePositions.mock.invocationCallOrder[0]).toBeLessThan(deps.registry.registerStrategy.mock.invocationCallOrder[0]);
    expect(registered.has('r1')).toBe(true);
  });

  it('does not apply the same run twice when this process re-adopts it', async () => {
    const { coordinator, deps, registered } = setup();
    const restorePositions = jest.fn(async () => 9);
    Object.assign(deps, { restorePositions });
    deps.leases.claimOrphans.mockResolvedValueOnce([run('r1')]);
    await coordinator.adoptOrphans();

    deps.leases.heartbeat.mockResolvedValueOnce([]); // another runner took it
    await coordinator.tick();
    expect(registered.has('r1')).toBe(false);

    deps.leases.claimOrphans.mockResolvedValueOnce([run('r1')]); // and handed it back
    await coordinator.adoptOrphans();
    expect(registered.has('r1')).toBe(true);
    expect(restorePositions).toHaveBeenCalledTimes(1);
  });

  it('leaves a run unadopted, lease released, when its positions cannot be read', async () => {
    const { coordinator, deps, registered } = setup();
    Object.assign(deps, { restorePositions: jest.fn(async () => { throw new Error('db down'); }) });
    deps.leases.claimOrphans.mockResolvedValue([run('r1')]);

    expect(await coordinator.adoptOrphans()).toEqual([]);
    expect(registered.has('r1')).toBe(false);
    expect(deps.leases.release).toHaveBeenCalledWith('r1');
    expect(coordinator.isHeld('r1')).toBe(false);
  });
});

describe('LiveRunCoordinator', () => {
  it('adopts orphaned runs: warms each up, then registers and subscribes it', async () => {
    const { coordinator, deps, registered } = setup();
    deps.leases.claimOrphans.mockResolvedValue([run('r1'), run('r2')]);

    const adopted = await coordinator.adoptOrphans();

    expect(adopted).toEqual(['r1', 'r2']);
    expect([...registered.keys()]).toEqual(['r1', 'r2']);
    expect(deps.subscribe).toHaveBeenCalledWith(['XOM', 'CVX']);
    // History before the first live tick.
    expect(deps.warmUp.mock.invocationCallOrder[0]).toBeLessThan(deps.registry.registerStrategy.mock.invocationCallOrder[0]);
    expect(coordinator.heldRuns()).toEqual(['r1', 'r2']);
  });

  it('still starts a strategy whose warm-up fails — cold beats not at all', async () => {
    const { coordinator, deps, registered } = setup({ warmUp: jest.fn(async () => { throw new Error('alpaca 429'); }) });
    deps.leases.claimOrphans.mockResolvedValue([run('r1')]);

    await coordinator.adoptOrphans();

    expect(registered.has('r1')).toBe(true);
  });

  it('parks a run it cannot rebuild instead of re-claiming it forever', async () => {
    const { coordinator, deps, registered } = setup({
      buildStrategy: jest.fn(() => { throw new Error('No factory for strategy type "x"'); }),
    });
    deps.leases.claimOrphans.mockResolvedValue([run('r1')]);

    await coordinator.adoptOrphans();

    expect(registered.size).toBe(0);
    expect(deps.markRunErrored).toHaveBeenCalledWith('r1', expect.stringContaining('No factory'));
    expect(deps.leases.release).toHaveBeenCalledWith('r1');
  });

  it('refuses to adopt a run approved for a different algorithm version', async () => {
    const { coordinator, deps, registered } = setup({
      buildStrategy: jest.fn((r: StrategyRun) => ({
        ...strategyFor(r),
        version: 5,
      })),
    });
    deps.leases.claimOrphans.mockResolvedValue([run('r1', { strategyVersion: 4 })]);

    await coordinator.adoptOrphans();

    expect(registered.size).toBe(0);
    expect(deps.markRunErrored).toHaveBeenCalledWith('r1', expect.stringContaining('Algorithm changed from v4'));
    expect(deps.leases.release).toHaveBeenCalledWith('r1');
  });

  it('stops trading a run the moment another runner holds its lease', async () => {
    const { coordinator, deps, registered } = setup();
    deps.leases.claimOrphans.mockResolvedValueOnce([run('r1'), run('r2')]);
    await coordinator.adoptOrphans();

    deps.leases.heartbeat.mockResolvedValue(['r2']); // r1 was taken
    const { lost } = await coordinator.tick();

    expect(lost).toEqual(['r1']);
    expect(registered.has('r1')).toBe(false);
    expect(registered.has('r2')).toBe(true);
    // Not ours to release anymore.
    expect(deps.leases.release).not.toHaveBeenCalled();
  });

  it('rides out a brief database outage without dropping anything', async () => {
    const now = { t: 1_000_000 };
    const { coordinator, deps, registered } = setup({}, now);
    deps.leases.claimOrphans.mockResolvedValueOnce([run('r1')]);
    await coordinator.adoptOrphans();

    deps.leases.heartbeat.mockRejectedValue(new Error('fetch failed'));
    now.t += 30_000; // one missed beat, well inside a 90s lease
    const { lost } = await coordinator.tick();

    expect(lost).toEqual([]);
    expect(registered.has('r1')).toBe(true);
  });

  it('fences itself when heartbeats have failed long enough that a peer may own the runs', async () => {
    const now = { t: 1_000_000 };
    const { coordinator, deps, registered } = setup({}, now);
    deps.leases.claimOrphans.mockResolvedValueOnce([run('r1')]);
    await coordinator.adoptOrphans();

    deps.leases.heartbeat.mockRejectedValue(new Error('fetch failed'));
    now.t += 80_000; // past 80% of the 90s lease
    const { lost } = await coordinator.tick();

    expect(lost).toEqual(['r1']);
    expect(registered.has('r1')).toBe(false);
  });

  it('deactivate stops the run and gives its lease back', async () => {
    const { coordinator, deps, registered } = setup();
    coordinator.activate('r1', strategyFor(run('r1')));

    await coordinator.deactivate('r1');

    expect(registered.has('r1')).toBe(false);
    expect(deps.leases.release).toHaveBeenCalledWith('r1');
    expect(coordinator.isHeld('r1')).toBe(false);
  });

  it('expires a sandbox run, records the stop, and releases its lease', async () => {
    const now = { t: 1_000_000 };
    const { coordinator, deps, registered } = setup({}, now);
    coordinator.activate('r1', strategyFor(run('r1')), now.t + 1_000);

    now.t += 1_001;
    const result = await coordinator.tick();

    expect(result.expired).toEqual(['r1']);
    expect(deps.markRunExpired).toHaveBeenCalledWith('r1', 'Paper sandbox run expired');
    expect(deps.leases.release).toHaveBeenCalledWith('r1');
    expect(registered.has('r1')).toBe(false);
  });

  it('releaseAll hands every lease back for an immediate successor', async () => {
    const { coordinator, deps } = setup();
    coordinator.activate('r1', strategyFor(run('r1')));
    coordinator.activate('r2', strategyFor(run('r2')));

    await coordinator.releaseAll();

    expect(deps.leases.release).toHaveBeenCalledTimes(2);
    expect(coordinator.heldRuns()).toEqual([]);
  });

  it('stamps new runs with its own identity and a lease expiry', () => {
    const { coordinator } = setup({}, { t: 5_000 });
    expect(coordinator.leaseFields()).toEqual({ leaseOwner: 'paper:host:1:abc', leaseExpiresAt: 5_000 + 90_000 });
  });

  it('stamps new runs with the broker account it trades', () => {
    const deps = {
      registry: { registerStrategy: jest.fn(), deregisterStrategy: jest.fn() },
      subscribe: jest.fn(),
      leases: { claimOrphans: jest.fn(), heartbeat: jest.fn(), release: jest.fn() },
      buildStrategy: jest.fn(), warmUp: jest.fn(), markRunErrored: jest.fn(), markRunExpired: jest.fn(),
      brokerAccount: 'PAMEMBER9',
      now: () => 5_000,
    };
    const coordinator = new LiveRunCoordinator('paper:host:1:abc', 90, deps as unknown as LiveRunCoordinatorDeps);
    expect(coordinator.leaseFields()).toEqual({
      leaseOwner: 'paper:host:1:abc', leaseExpiresAt: 95_000, brokerAccount: 'PAMEMBER9',
    });
  });
});
