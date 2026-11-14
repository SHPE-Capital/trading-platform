# Stream P1: Platform strategy (TypeScript port)

Back to [MOMENTUM_TASKS.md](MOMENTUM_TASKS.md). Repo: **trading-platform**,
backend.

Ports the research reference (stream B plus the allocation rules from C3/C4) to
the platform, so the paper strategy runs inside the club platform's engine.
Strategies may not call external services (platform rule), so the live
decision logic is TypeScript and must match the Python output on the golden
fixtures (P1-6).

Existing code to build on: `backend/src/services/indicators/` (`ema.ts`,
`sma.ts`, `volatility.ts`), `backend/src/strategies/base/strategy.ts`,
`backend/src/config/strategyManifest.ts`, `backend/src/config/strategyCatalog.ts`,
`backend/src/core/sizing/IPositionSizer.ts`, `backend/src/core/live/strategyWarmer.ts`,
`backend/src/strategies/momentum/index.ts` (placeholder to replace).

Checks: `npm --prefix backend run typecheck`, `npm --prefix backend run lint`,
`npm --prefix backend test -- --runInBand <path>`.

---

## P1-1 Indicators

- **Owns:** `backend/src/services/indicators/atr.ts`, `adx.ts`,
  `rollingHigh.ts`, `clockRelativeVolume.ts`, `sessionVwap.ts`, their tests
  under `backend/src/tests/services/`, exports in `services/indicators/index.ts`
- **Depends on:** nothing (hand-calculated tests now; golden check in P1-6)
- **Spec:** App. A; must match the B1–B3 incremental forms
- **Work:** incremental per-bar implementations: Wilder ATR14; ADX/±DI with the
  **same initialization as B1**; the rolling max of the preceding n highs
  (current bar excluded); clock-window relative volume (median over 20 prior
  sessions, at least 15 windows); typical-price session VWAP reset each
  session. Reuse `ema.ts` if its smoothing factor is 2/(n+1), otherwise add a
  variant.
- **Done when:** the unit tests match hand-worked values. Can be split across
  two people: (ATR, ADX) and (rolling high, RVOL, VWAP).

## P1-2 Weekly config loader

- **Owns:** `backend/src/strategies/momentum/weeklyConfig.ts` (types mirroring
  0-A), `backend/src/strategies/momentum/weeklyConfigLoader.ts`, tests
- **Depends on:** 0-A schema
- **Spec:** §11 step 6, "The conservative initial operating policy is to
  disable new entries when a fresh approved weekly artifact is missing"
- **Work:** load and validate the artifact (schema version check, refuse
  unknown versions); expose the active config only for its activation week;
  **missing, stale or invalid artifact means entries are disabled** (existing
  positions keep their protection); switch configs only while flat; read the
  universe from the artifact. Decide with P3-1 where artifacts are stored
  (Supabase table or storage bucket).
- **Done when:** tests cover valid, stale, missing, wrong version, and
  `no_deployment` artifacts.

## P1-3 `BreakoutMomentumStrategy` and manifest

- **Owns:** `backend/src/strategies/momentum/` (`breakoutMomentumStrategy.ts`,
  `breakoutMomentumConfig.ts`, `breakoutMomentumTypes.ts`, `manifest.ts`,
  `index.ts`), `backend/src/tests/strategy/breakoutMomentumStrategy.test.ts`;
  catalog registration in `backend/src/config/strategyCatalog.ts` (**Coordinate**)
- **Depends on:** P1-1, P1-2
- **Spec:** §2, §3 "Before the regular session", "Each completed minute" steps
  1 and 3
- **Work:** update each indicator once per completed bar (validate the symbol,
  interval, prices and volume); apply the readiness rules (B4); evaluate the
  active group (breakout AND the selected confirmations); skip stocks already
  entered today; record indicator values with every candidate (ties into the
  existing P1 candidate-log task in `research-python/docs/platform-tasks.md`);
  warm up indicators through `strategyWarmer.ts`.
- **Done when:** a platform backtest runs on cached bars with a fixture
  artifact and emits signals.

## P1-4 Minute batch and cross-stock allocator

- **Owns:** `backend/src/strategies/momentum/batchAllocator.ts`, tests;
  **Coordinate** with `core/engine/orchestrator.ts` and `core/oms/` owners if a
  hook is needed
- **Depends on:** P1-3
- **Spec:** §3 step 4 and the batching paragraph
- **Work:** today `evaluate()` returns one signal per context and the order
  queue ranks by strategy *type*. This strategy needs:
  - one decision batch per minute, closing 1 second after the scheduled
    minute end (bars that arrive later are excluded and logged)
  - all candidates in the batch ranked by descending 20-session median daily
    dollar volume, with the stable asset ID as tie-break
  - allocation within the remaining capacity (10 positions, 80% exposure,
    pending reservations)

  Decide the integration point with the backend owner (inside the strategy
  vs an orchestrator hook) and write it down before coding.
- **Done when:** a batch with more candidates than capacity allocates in the
  same order as C4 on the golden scenario.

## P1-5 Funded-account sizer

- **Owns:** `backend/src/core/sizing/fundedAccountSizer.ts`, test; registration
  where sizers are selected (**Coordinate**)
- **Depends on:** nothing (spec from C3)
- **Spec:** §4 (same rules as C3)
- **Work:** floor(min(8% equity / price, 0.25% equity / (1.5 × ATR), cash after
  reservations / price, room under 80% exposure / price, 1% of the median
  same-minute volume over 20 sessions with at least 15 observations)). Zero
  means no order, with a reason.
- **Done when:** the guide's 160-share example passes and each cap binds in a
  test.

## P1-6 Golden parity test

- **Owns:** `backend/src/tests/strategy/breakoutMomentumParity.test.ts`, the
  copied fixtures under `backend/src/tests/fixtures/momentum_golden/`
- **Depends on:** 0-D, B6, P1-1, P1-3 (and P1-4/P1-5 for the order section)
- **Spec:** §12 "parity tests must prove identical decisions on the same event
  stream before it is accepted"
- **Work:** feed the golden input events, then compare indicator values
  (within tolerance), signals (exact) and ranked/sized orders (exact).
- **Done when:** it is green in CI. **Paper deployment is not allowed until
  this passes.**
