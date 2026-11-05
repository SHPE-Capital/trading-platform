# Branch review and resume evidence - October 22, 2026

Remote references were refreshed with `git fetch origin`. Comparisons used the
`JC` checkpoint `ec782e3`; the course replay fix is a subsequent change on `JC`.
No other branch was merged as part of this review.

## Branch findings

| Branch | Finding |
|---|---|
| `origin/main` (`2340393`) | Same source tree as pre-checkpoint `JC` (`17f5e78`); the differing commits are merges. |
| `origin/p/workshop_practice1` (`c5ad986`) | Older workshop starting point. Its commits outside `JC` are merge commits, and its diff from the common ancestor adds no implementation; it lacks newer platform features. |
| `origin/feat/live-trading`, `origin/feat/strategy_planning`, `origin/fix/backtest-pipeline-stability`, `origin/order_manager` | Ancestors of the checkpoint; their work is already included. |
| `origin/feat/backtest_system` | The remaining non-merge commit, `11cec02`, is patch-equivalent to work already on `JC` (`git cherry` reports `-`). No missing backtest implementation to import. |
| `origin/feat/JEST-testing` | `2d2d60a` is also patch-equivalent to work already on `JC`. It adds preset-configuration schema, not new test results. |
| `origin/perf/platform-optimizations` (`d537f81`) | Seventeen additional commits, including profiling-driven optimizations, state corrections, bounded order retention, telemetry, and benchmark charts. These improvements remain on this branch. |

## Strongest additional measurements

Source: [performance-branch audit, section 8](https://github.com/SHPE-Capital/trading-platform/blob/d537f81/docs/history/latency-audit-2026-10-12.md#8-follow-up-2026-10-20-second-optimisation-pass-perfplatform-optimizations).
These are recorded branch results, not newly executed benchmarks in this review.

- Pairs-trading synthetic replay: **75,015 to 118,170 frames/s (+58%)**.
- Twenty quote-imbalance strategies: **3,673 to 6,738 frames/s (+83%)**.
- Null-strategy per-frame processing p99: **0.029 to 0.012 ms (about 59% lower)**.
- Synthetic one-year SPY/QQQ pairs backtests: **about 13% faster**, with identical orders, fills, and equity.
- Backend development-container steady memory: **about 320 MB to 95 MB per container (about 70% lower)** after switching development ts-node processes to transpile-only; CI retains type checking.

Replay throughput figures are medians of 5-7 repetitions on a Windows desktop,
using synthetic frames, the simulated sink, and disabled instrumentation.
Decision/fill checksums match within each comparison. Frames/s is not historical
bars/s, broker latency, or measured EC2 capacity. Do not combine percentages
from the first and second optimization passes into a single controlled result.

The implementation details behind the latest pass include counter-based IDs for
transient event envelopes (persisted entities keep UUIDs), Date-free RFC3339
parsing with equivalence tests, lighter risk views, allocation-free risk-check
dispatch, lazy rolling windows, on-demand post-fill snapshots, and memoized
timeframe parsing. The branch also handles updated bars/trade corrections without
re-evaluating strategies and prunes closed orders older than six hours.

Other backend details already on `JC` include a durable PostgreSQL backtest queue
with `FOR UPDATE SKIP LOCKED`, expiring worker leases and recovery, journal-before-
submit orders, capital reservations, broker-ledger reconciliation, and a shared
strategy catalog for historical and trading runtimes.

## Suggested resume wording

The performance bullet below describes completed work on the separate performance
branch. It does not imply that it is merged into `JC` or deployed on EC2.

### Four bullets

- Led 16 SHPE members developing a TypeScript, Express, React, and PostgreSQL trading platform, owning sprint planning and PR reviews
- Architected a shared event-driven engine across live, paper, and backtest modes, decoupling strategies from market data, risk checks, capital reservations, and journaled order execution
- Optimized event IDs, timestamp parsing, and risk-state allocations, increasing synthetic replay throughput 58% to 118K frames/s while preserving decision and fill checksums
- Established isolated Docker/Supabase development environments and GitHub Actions CI/CD for AWS EC2 deployment with commit-tagged images, health checks, and automatic rollback

### Three bullets

- Led 16 SHPE members building a TypeScript, Express, React, and PostgreSQL trading platform with shared market-data, risk, and execution infrastructure across live, paper, and backtest modes
- Optimized event IDs, timestamp parsing, and risk-state allocations, increasing synthetic replay throughput 58% to 118K frames/s while preserving decision and fill checksums
- Standardized isolated Docker/Supabase development environments and automated AWS EC2 deployments through GitHub Actions with commit-tagged images, health checks, and automatic rollback

### Alternative systems bullet

- Built a durable PostgreSQL backtest queue with atomic job claims, expiring worker leases, and request deduplication, isolating historical simulations from paper-trading processes

## Course strategy verification

The guide's reference is `beginner_reversal` (SPY/AAPL, one share per order and a
one-share position cap). The separate unfinished `jcavallin_tutorial` exercise
was preserved in the checkpoint and remains excluded from the build.

The replay fix starts playback after the first post-boot subscription, resumes
when a newly subscribed symbol has later data, avoids duplicate playback timers,
and ignores cache reads completed after disconnect. The guide now seeds the
reference symbols and places replay settings in the Docker launcher's shell.

Verification: backend typecheck and build passed; lint passed with 21 existing
warnings and no errors. All **113 test suites / 1,385 tests** passed, including
HTTP contracts and new integration coverage for cached reference backtests,
journaled local paper fills, and paper-adapter submission with mocked HTTP.

Docker Desktop's engine was unavailable on this machine. A running local
Supabase stack and actual personal Alpaca paper connectivity were not exercised;
the paper-submission integration test does not send broker orders.
