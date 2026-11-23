# Latency audit and benchmark implementation — 2026-10-12

Point-in-time record for [the agent guide](../guides/LATENCY_BENCHMARK_AGENT_GUIDE.md)'s
Ticket A, plus what was built for Tickets B–I and what is still outstanding.
How to run everything: [guides/latency-benchmark.md](../guides/latency-benchmark.md).

- **Inspected commit:** `f2e3ce6` (branch `JC`), clean working tree before these changes.
- **Measured on:** a Windows 11 desktop (Ryzen 7 3700X, 16 GB, Node 25.2) with
  **synthetic** input only. Every number below is indicative of processing cost
  on that machine. None is a live, AWS or Alpaca measurement.

## 1. Guide §3 observations, rechecked

| Observation | Holds? | Evidence |
|---|---|---|
| Adapter subscribes to quotes, trades and bars | Yes | `marketData.ts` `subscribe()` sends all three |
| Orchestrator evaluates every strategy on every quote/trade/bar | Yes | `_onQuote/_onTrade/_onBar` → `_evaluateStrategies` |
| Event bus is synchronous; a slow handler delays the next frame | Yes | `EventBus.publish` loops handlers inline |
| `ts` is ms, `isoTs` keeps the string; no receipt-to-order tracing existed | Yes | `normalizer.ts`; nothing stamped receipt |
| Quote normalizer modelled one `exchange` field; sizes unit unclear | Yes | Alpaca sends `bx`/`ax`, not `x`; docs state quote sizes are **round lots** |
| Bars overwrite `latestMid` with the close | Yes | `SymbolStateManager.onBar` |
| Awaited journal write before every broker call | Yes | `JournaledExecutionSink` (fail-closed) |
| Backtest factory registers only `pairs_trading` | Yes | `core/backtest/strategyFactory.ts` (the runtime factory also has `minute_reversal`) |
| Replay components are bar/event replays, not recorded frame replay | Yes | `ReplayEngine` (events), `ReplayBarFeed` (cached bars) |
| Production colocates api, paper-trading and a 1-CPU backtest worker | Yes | `deploy/docker-compose.prod.yml` |
| Local default is `EXECUTION_TARGET=sim` | Yes | `config/env.ts`, `docker-compose.dev.yml` |

## 2. What existed vs. what was missing (before)

| Capability | Before | Now |
|---|---|---|
| Receipt stamping, frame/epoch identity | none | `AlpacaMarketDataAdapter` (optional, `options.probe/observers`) |
| Stage timing and correlation | none | `core/telemetry/latencyProbe.ts`; orchestrator `options.probe`; order-path decorators |
| Bounded histograms | none | `core/telemetry/histogram.ts` (fixed memory, mergeable) |
| Provider-time precision | `Date` (ms) only | `core/telemetry/clock.ts` keeps all 9 digits |
| Data validation / quarantine | none | `validateRaw*` in the normalizer; opt-in `invalidData: "quarantine"` |
| Raw frame recording | none | `core/telemetry/frameRecorder.ts` (bounded, hashed, loss-accounted) |
| Recorded frame replay with pacing | none | `bench/processingReplay.ts` through the real adapter path |
| Strategy delay/cost simulation | none | `bench/delaySimulator.ts` |
| Resource sampling | none | `core/telemetry/resourceMonitor.ts` |
| Run manifest, report | none | `bench/manifest.ts`, `bench/report.ts` |
| Paper-order probe | none | `bench/paperProbe.ts` (gated) |

Behaviour with instrumentation **off** (the default everywhere) is unchanged. A
test asserts the adapter publishes identical events with and without a probe.
Another asserts the engine makes identical decisions under every
instrumentation level.

## 3. Changes to existing code

All are small and default-off:

- `types/events.ts`: optional `trace` on events (JSON-safe; strategies never read it).
- `types/market.ts`: optional `bidExchange`, `askExchange`, `tape` on `Quote`; size-unit doc; `MarketDataIssue` type.
- `adapters/alpaca/normalizer.ts`: keeps `bx`/`ax`/`z`; `NORMALIZER_VERSION`, `QUOTE_SIZE_UNIT`; validators.
- `adapters/alpaca/marketData.ts`: optional probe/observers/URL/quarantine. `ingestFrame()` for replay. Records lifecycle (incl. the server's subscription ack, previously ignored). **Fix:** a frame that parsed to a non-array, or an array with `null` elements, threw inside the socket callback; it is now counted and skipped.
- `adapters/alpaca/orderExecution.ts`: optional `onTradeUpdate` receipt hook (sees `new`/`accepted` acks, which never reach the bus).
- `core/engine/orchestrator.ts`: optional `probe`. Carries `trace` from market event → signal → intent. Times state/evaluate (stage detail) and the risk path.
- `runtime/bootstrap.ts`, `config/env.ts`: `LATENCY_PROBE=1` attaches instrumentation to the runner's own stream (no second connection).

## 4. Findings with evidence

Ordered by the guide's §17 priority. As found at `b96b53c`. Findings 1–5 were
then fixed one commit at a time against a preserved baseline; see §7.

1. **One-sided IEX quotes become prices (correctness, priority 1)** — *fixed in
   `51003e0`*. IEX sends
   quotes with `bp` or `ap` = 0. They normalize to a mid of about half the
   price, which then marks positions (`portfolioState.updatePrice`) and can trip
   drawdown checks. The validator classifies them as `ONE_SIDED_QUOTE`.
   `invalidData: "quarantine"` drops them, but it is **not enabled** in the
   runtime. Recommended next step: count them in a live capture
   (`issues.quote.ONE_SIDED_QUOTE`), then enable quarantine as its own versioned
   change.
2. **Unparseable timestamps can wedge rolling windows (correctness)** — *fixed
   in `c560cd7`*. A quote
   with a bad `t` gets `ts = NaN`. `RollingTimeWindow.evict` cannot order `NaN`,
   so the item is never evicted cleanly. Quarantine also prevents this.
3. **A full portfolio snapshot on every market event (priority 3)** — *fixed in
   `8f59a76`*.
   `_proactivePortfolioCheck` calls `portfolioState.getSnapshot()` per
   quote/trade/bar. That builds every position, an ISO timestamp and a UUID.
   CPU profile of the uninstrumented engine on synthetic quotes: `getSnapshot`
   is **18%** of busy CPU and UUID generation **12%**. Cheaper alternatives (a
   numeric equity check, or a snapshot without id/ISO fields) should be measured
   with `bench replay` before and after.
4. **Strategies are re-sorted on every event (priority 3)** — *fixed in
   `4c0d455`*.
   `_evaluateStrategies` copies and sorts the registry each call (21% inclusive,
   including the evaluation itself). It scales with strategy count: 20
   `quote_imbalance` instances cut synthetic throughput from ~40k to ~15k
   frames/s.
5. **Rolling-window eviction copies arrays (priority 3)** — *fixed in
   `283e1fc`*. `evict()` uses `slice`, an O(window) copy per evicting push. The
   2% estimate here was wrong: it came from a short run whose 60 s windows were
   never full. Once they are, this was the largest single cost (§7).
6. **Not consumed downstream (information, not a bug):** trade corrections `c`,
   cancels/errors `x`, updated bars `u`, statuses `s` and LULD `l` arrive (the
   first two are subscribed automatically with trades) and are now counted as
   `messages.unhandled.*`. Late-trade bar revisions (`u`) are why a minute bar's
   close can differ from the revision.

Instrumentation overhead (A/A, 5 interleaved repetitions, maximum throughput):
counters-only about 9% (2 µs/frame) and the intended sampled config about 12%
(3 µs/frame). On this desktop that is inside the run-to-run spread (13–25%), so
it is **not established** against the provisional 5% gate. Re-run
`bench fixture` / `bench replay --overhead` on the Linux target. At live IEX
frame rates, 3 µs per frame is negligible against a 10 ms budget, but that is an
inference, not a measurement.

Synthetic processing (one strategy, null sink, max throughput): frame
receive-to-done p99 about 0.11 ms; in-memory receive-to-submit p95 about
0.16 ms (n = 240, so no p99). These say nothing about Supabase journal latency,
Alpaca REST latency or live event age, which need the steps below.

## 5. Ticket status

| Ticket | Status |
|---|---|
| A audit | This document |
| B trace context and metrics | Done (frame and stage detail levels; A/A tested) |
| C normalization fidelity | Done (validation, venues, units documented, precise time); runtimes quarantine unusable data by default since `51003e0` |
| D bounded recorder | Done (rotation, hashes, gaps, disk caps, truncated-tail handling, redaction) |
| E replay and load generator | Done (max/paced/burst, lateness, coordinated omission, null and sim sinks, determinism checksums) |
| F delay simulator | Done (plan-gated, splits, ledger, empirical delays) |
| G runtime health and AWS baseline | Code done (monitor, manifest incl. EC2/cgroup/clock); **AWS runs not yet done** |
| H bounded paper probe | Code done and gated; **not run** (needs a dedicated paper account during market hours) |
| I evidence-based optimization | Findings 1–5 fixed against a synthetic baseline (§7). Still to confirm on a live capture and on AWS |

## 6. Outstanding external prerequisites

1. A market-hours `bench capture` with personal data keys (SPY/QQQ first, then
   wider), checking `issues.*`, event ages and acknowledged subscriptions.
2. Replay of that capture, locally and on the EC2 host (contended and idle).
   `bench report --compare` across them.
3. A `LATENCY_PROBE=1` window on a runner, to measure the real Supabase journal
   and Alpaca paths.
4. Optionally `bench paper` on a dedicated paper account.
5. `bench delay` with a predeclared plan on real captures (development split
   first; evaluation once).

## 7. Follow-up: findings 1–5 fixed (same day)

Each fix is its own commit, measured against a fixed recording (`bench fixture
--duration-s 300 --symbols SPY,QQQ,IWM,AAPL,MSFT --write-recording`, seed 42:
synthetic, 5 symbols, ~50 quotes and 10 trades per second each). Replays used
`--invalid-data pass --sink sim --sample 0`, 5–7 repetitions per configuration,
on the same Windows desktop. Medians in frames/s; run-to-run spread was 3–27%.

| Configuration | `b96b53c` baseline | `8f59a76` risk view | `4c0d455` strategy order | `283e1fc` window eviction |
|---|---|---|---|---|
| `quote_imbalance` ×1 | 35,459 | 37,733 | 40,103 | 82,151 |
| `quote_imbalance` ×20 | 4,825 | 5,000 | 5,146 | 5,634 |
| `null` | 38,202 | 42,113 | 48,812 | 92,349 |
| `pairs_trading` (SPY/QQQ) | 36,362 | 46,204 | 49,145 | 94,603 |
| `minute_reversal` | 38,062 | 45,362 | 49,667 | 99,113 |

- **Decision and fill checksums were identical in every column** for every
  configuration. The three performance changes did not change a single
  decision or fill.
- Per-frame processing p99 (null strategy) went from 0.082 ms to 0.022 ms.
- The 20-strategy configuration gains least: its cost is dominated by about 1M
  signals per run, each building intents, risk checks and a full snapshot.
- The quarantine change (`51003e0`) was measured separately. It made identical
  decisions on this clean data, and validation cost 0–7% at maximum
  throughput, within noise. It changes behaviour only for unusable messages,
  by design. `MARKET_DATA_INVALID_POLICY=pass` restores the old behaviour.
- Instrumentation overhead re-measured on the faster engine (A/A, 5
  repetitions): counters-only 4.7% (0.7 µs/frame), sampled 9.0% (1.4 µs/frame),
  stages 17.6%, full with recording 75.6%. "Sampled" is still above the
  provisional 5% gate at maximum throughput on this host; judge it on Linux.

### Next candidates (done 2026-10-20, see §8)

From a CPU profile of the engine after `283e1fc` (`quote_imbalance`, no probe,
quarantine on):

1. **A UUIDv4 for every published event:** about 7% of CPU (`newId`,
   `serializeUUID`, `randomFillSync`). Market-data events could use a cheap
   process-unique id; persisted events keep UUIDs.
2. **`Date` parsing of every provider timestamp** (`isoToMs`, about 5%). The
   telemetry fast parser gives the same millisecond and could replace it.
   Prove equivalence on a capture first.
3. **A full snapshot per order intent** (`_onOrderIntent` → `getSnapshot`).
   This matters only for signal-heavy strategies (the ×20 configuration).

None of this replaces the live-capture and AWS measurements in §6.

## 8. Follow-up 2026-10-20: second optimisation pass (`perf/platform-optimizations`)

Nineteen feature commits had landed on `JC` since §7 and cost 15–35% on the
same recording (e.g. `quote_imbalance` ×1 82k → 53k frames/s), with identical
decisions. This pass started from that baseline. Each change is its own
commit, with checksums compared and the full suite run.

| Configuration | `JC` baseline (`bacbdd6`) | Final | Change |
|---|---|---|---|
| `quote_imbalance` ×1 | 52,984 | 86,939 | +64% |
| `quote_imbalance` ×20 | 3,673 | 6,738 | +83% |
| `null` | 80,952 | 126,973 | +57% |
| `pairs_trading` | 75,015 | 118,170 | +58% |
| `minute_reversal` | 71,169 | 116,583 | +64% |

Frames/s, median of 5–7 repetitions, Windows desktop, `--invalid-data pass
--sink sim --sample 0`. **Decision and fill checksums are identical in every
row.** Per-frame processing p99 (null) went from 0.029 to 0.012 ms. Synthetic
backtests (`BacktestEngine`, one year of minute bars for SPY/QQQ pairs) gave
identical orders, fills and equity; pairs ran about 13% faster.

What changed:
- Market-data and internal event envelopes use `newEventId()` (a counter)
  instead of UUIDv4. Persisted ids (signals, intents, orders, fills) stay
  UUIDs.
- `rfc3339ToEpochMs` replaces `new Date(iso)` in the normalizer and
  validation. It is property-tested equal to `Date`, including NaN and V8's
  >9-digit quirk.
- Per-intent risk checks read `PortfolioRiskView` (cash, equity,
  initialCapital, positions); `_runChecks` no longer allocates closures.
- The post-fill `PORTFOLIO_UPDATED` snapshot is built only when something
  subscribes (`EventBus.hasSubscribers`). Backtests have no subscriber.
- `SymbolState` rolling windows record only once read: nothing in the
  platform reads them. `GET /api/market-data/snapshot/:symbol` no longer
  serialises them.
- `timeframeToMs` is memoised.
- Rolling windows keep late (out-of-order) items in time order and evict
  from the newest timestamp.
- The runtime prunes closed orders older than 6 h, so memory stayed bounded
  over long runs.
- Updated bars, trade corrections and cancels now correct symbol state
  (state-only, never re-running strategies).
- Order submit → HTTP response-headers timing is measured.
- Reports draw latency and delay-curve SVG charts.

**Dev containers.** The "27% of 1600%" Docker reading was startup: each
backend container ran `ts-node` with full type-checking, about 20 s at 1–2
cores, three at once. Idle CPU was about 0%. Dev runners now use
`ts-node --transpile-only` (types still enforced by `npm run typecheck`, CI
and the editor). Startup work is about 12 s, and steady memory went from
~320 MB to ~95 MB per backend container (four app containers: ~950 MB →
~445 MB). No GPU is used by any part of the stack.

**Linux (WSL2, Docker, Node 22).** Fixture checks pass. Event-loop delay
p50 is 0.002 ms, so measurement is reliable on Linux, unlike Windows. Frame
receive-to-done p99 is 0.045 ms; receive-to-submit p99 is 0.13 ms
(in-memory journal). A/A on the fixed recording: the intended "sampled"
config costs ~1.4 µs per frame (12.6% at maximum throughput, inside a
13–23% run-to-run spread).

**Where it stops.** In the final profile of the live path, about 18% is
native `JSON.parse` of frame text inside the adapter, ~13% is runtime/GC,
and the rest is spread thinly (each ≤ 2%). A full-string timestamp cache
was tried and reverted: no measurable gain. Going further would need a
custom frame parser or moving parsing to worker threads, which is
rewrite-level for a few percent. The backtest path is dominated by GC from
per-order objects and the UUIDs that results persist.

Still requires you: a market-hours capture, a `LATENCY_PROBE` window and
the paper probe against real Alpaca/Supabase (§6). EC2 numbers also need
the runbook's §6.
