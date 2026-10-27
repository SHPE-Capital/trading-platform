# Latency benchmark runbook

How to measure this platform's latency and decide whether latency work is worth
doing. This is the current command reference. The earlier
[implementation specification](../history/implementation-plans/guides-LATENCY_BENCHMARK_AGENT_GUIDE.md)
is historical design context; the codebase audit and first findings are in
[history/latency-audit-2026-10-12.md](../history/latency-audit-2026-10-12.md).

Benchmark CLI commands run from `backend/`. Their outputs go to
`artifacts/latency/<run-id>/` at the repo root (git-ignored). Runner instrumentation
is enabled in the runner's environment and can use a different artifact root
(see section 3). Every run directory is new: nothing overwrites an
earlier result.

## What can run where

| Command | Needs | Can it send orders? | Measures |
|---|---|---|---|
| `bench:fixture` | nothing | No (null/sim sink, `fetch` disabled) | Correctness on the checked-in fixture, processing cost on a seeded synthetic session, instrumentation overhead |
| `bench:replay` | a recording | No (same) | Processing cost and capacity on recorded frames |
| `bench:delay` | a plan (+ a recording, or `--synthetic`) | No (simulation) | Strategy result vs. added order delay and costs |
| `bench:capture` | your **own** Alpaca data keys, market hours | No (null sink, `fetch` disabled) | Live event age, live load, hypothetical signals; writes a recording |
| `LATENCY_PROBE=1` on a runner | the running stack | Only what that runner already sends | The real runtime on its own stream, incl. the Supabase journal and broker calls |
| `bench:paper` | your own Alpaca **paper** account, Supabase, market hours | **Yes — bounded paper orders** | Journal → REST → `trade_updates` timings |

Free IEX is one exchange, not the consolidated market. Quote sizes are round
lots. Paper fills are Alpaca's simulation. Nothing here says anything about
real-money fill quality or "HFT readiness".

## 1. Offline: fixture and synthetic benchmark (start here)

```sh
cd backend
npm install
npm run bench:fixture
```

This builds the backend, then:

1. Replays the checked-in edge-case fixture (`src/bench/fixtures/edgeCaseFixture.ts`)
   and checks ~40 stated expectations (counts, validation issues, epochs,
   sub-millisecond timestamps, shared batch receipt, quarantine, repeatability).
   **The command exits non-zero if any fail**; see `data-quality.json`.
2. Generates a seeded synthetic session and runs the processing benchmark
   (default 3 repetitions at maximum throughput).
3. Runs the A/A overhead experiment: disabled / counters / sampled / stages /
   full instrumentation, interleaved.

Useful options (all commands reject unknown flags):

```sh
npm run bench:fixture -- --duration-s 300 --quote-rate 200 --symbols SPY,QQQ,IWM,AAPL,MSFT
npm run bench:fixture -- --strategy quote_imbalance --strategy-count 20 --sink sim
npm run bench:fixture -- --pacing paced --speed 1 --burst 60000:5000:10 --deadline-ms 10
npm run bench:fixture -- --write-recording   # also save the session as a recording for replay/delay
```

`--burst start:duration:multiplier` multiplies the synthetic arrival rate.
`--replay-burst` (with `--pacing paced`) compresses time in a window instead.
Synthetic rates are workload parameters, not a model of IEX. Reports say so.

## 2. Live shadow capture (market hours, your own data keys)

Alpaca's free plan allows **one** market-data stream per account. Before
capturing, make sure nothing else is streaming with the same keys. The local
paper runner only streams if you started the stack with `LOCAL_STREAM_DATA=1`.

```sh
# backend/.env (or your shell): ALPACA_DATA_KEY / ALPACA_DATA_SECRET = YOUR keys
npm run bench:capture -- --symbols SPY,QQQ --duration-min 30 --confirm-stream-owner
```

- Records every inbound frame to `<run>/recording/` (bounded by
  `--max-record-mb`, `--min-free-mb`; drops are counted, never silent).
- Runs the real adapter → orchestrator → risk → in-memory journal → **null
  sink**. Strategies decide and orders are risk-checked, but nothing leaves
  the process.
- Outside 09:30–16:00 New York time, or with `--feed test`, the run is labelled
  a *protocol test* and marked not comparable.
- Ctrl-C stops it cleanly. `metrics.partial.json` is refreshed every
  `--progress-s`.

Then replay the capture as often as you like:

```sh
npm run bench:replay -- --recording ../artifacts/latency/<capture-run-id>
npm run bench:replay -- --recording <dir> --strategy null                  # parse/state overhead
npm run bench:replay -- --recording <dir> --strategy quote_imbalance --strategy-count 20
npm run bench:replay -- --recording <dir> --pacing paced --speed 1         # realistic arrival
npm run bench:replay -- --recording <dir> --pacing paced --speed 10        # find the first failure
npm run bench:replay -- --recording <dir> --overhead                       # A/A on real frames
npm run bench:replay -- --recording <dir> --detail stage --sample 0.05     # per-stage diagnosis
```

## 3. Instrumenting a running runner (the existing stream owner)

To measure the real runtime, including the Supabase journal wait and real
broker calls, without opening a second stream:

```sh
# Local stack (repo root):
LATENCY_PROBE=true LATENCY_RECORD=true LOCAL_STREAM_DATA=1 npm run dev:stack
# → backend/artifacts/latency/<run-id>/ ; metrics.json refreshes every 60 s
```

It only observes. With `LATENCY_PROBE=false` (the default) nothing changes.
Settings are in `backend/.env.example` (`LATENCY_*`). The final
`decision-report.md` is written when the runner shuts down cleanly. Run
`npm run bench:report -- --run <dir>` to rebuild it at any time.

## 4. Delay and cost sensitivity

Write the plan **before** looking at results: strategy, symbols, a development
and an untouched evaluation date range, delays, cost scenarios, seeds and the
written selection criterion.

```sh
npm run bench -- plan-template --write ../my-plan.json     # then edit it
npm run bench:delay -- --plan ../my-plan.json --recording <dir>                 # development split
npm run bench:delay -- --plan ../my-plan.json --recording <dir> --split evaluation --confirm-evaluation-split
npm run bench:delay -- --plan ../my-plan.json --synthetic                        # mechanics only
npm run bench:delay -- --plan ../my-plan.json --recording <dir> \
  --empirical-from ../artifacts/latency/<run>/metrics.json                       # measured delay distribution
```

- The injected delay is **additional** decision-to-order-arrival latency. The
  recording's own arrival order is the zero baseline (feed delay is not counted
  twice).
- Orders fill against the latest valid quote observed at or before arrival.
  Buys pay the ask, sells receive the bid, then slippage and fees apply. Fills
  are capped at displayed size (round lots × `lot_size_shares`). A stale or
  missing quote leaves the order unfilled.
- Every run is appended to `artifacts/latency/delay-ledger.ndjson`. Reusing
  the evaluation split prints a warning; results from it are then no longer
  out-of-sample.

## 5. Paper-order probe (optional, explicit)

Use a **dedicated** Alpaca paper account. The probe refuses protected shared
accounts unless `--allow-shared-account` is passed after review.

```sh
# backend/.env: EXECUTION_TARGET=alpaca-paper, ALPACA_API_KEY/SECRET = your PAPER keys
# local Supabase running (npm run dev:stack) — orders are journaled like the runtime's
npm run bench:paper -- --confirm-paper-orders --symbol SPY --max-orders 4 --max-notional-usd 1000
```

It sends at most `--max-orders` 1-share market orders (buy when flat, sell when
long). Each goes through the orchestrator's risk checks, the Supabase journal
and the Alpaca REST call. The probe then waits for `trade_updates`, cancels
anything unfilled, flattens only its own position and checks the account
position before and after. An ambiguous submit is looked up by
`client_order_id`, **never re-sent**. If it can't be resolved the probe stops
and reports it. The per-order table is in `paper-orders.csv`.

## 6. On the AWS host (2 vCPU / 8 GB)

The production image has no source and runs as a non-root user. Run the
benchmark in a throw-away container from the same image, writing to a host
directory:

```sh
cd ~/app && mkdir -p ~/latency
docker compose --env-file .deploy.env -f docker-compose.prod.yml run --rm --no-deps \
  --user "$(id -u):$(id -g)" -v ~/latency:/out paper-trading \
  node dist/runtime/bench.js fixture --out /out
# Replay a capture made elsewhere (copy it to ~/latency/<run>/recording first):
docker compose --env-file .deploy.env -f docker-compose.prod.yml run --rm --no-deps \
  --user "$(id -u):$(id -g)" -v ~/latency:/out paper-trading \
  node dist/runtime/bench.js replay --recording /out/<capture-run-id> --out /out
```

- **Never run `capture` with the club's data keys there.** The production paper
  runner owns that stream, and a second connection disconnects it. Capture with
  personal keys (`-e ALPACA_DATA_KEY=… -e ALPACA_DATA_SECRET=…`). Or, in an
  announced window, set `LATENCY_PROBE=true` and
  `LATENCY_PROBE_DIR=/tmp/shpe-latency/<name>` in the server `.env` and
  restart only `paper-trading`. Copy the results out with
  `docker compose cp paper-trading:/tmp/shpe-latency ./latency`.
- Run first with the stack as it normally runs (contention included), then
  in a window where `backtest-worker` is idle. Compare the two with
  `bench report --run <a> --compare <b>`.
- Before each run, capture the diagnostics from the guide (§12): `date -u`,
  `uname -a`, `lscpu`, `free -m`, `df -h`, `docker stats --no-stream`,
  `chronyc tracking`, `chronyc sources -v`. The manifest collects most of these
  automatically (and the EC2 instance type and AZ via IMDSv2). On burstable
  instances, also check `CPUCreditBalance` in CloudWatch.

## Reading the outputs

| File | Contents |
|---|---|
| `manifest.json` | Code SHA and dirty state, host, container limits, clock sync, workload, settings, validity and reasons |
| `metrics.json` | Probe snapshot (mergeable histograms, counters, sampling denominators, lifecycle), replay runs, resources, recorder |
| `latency-summary.csv` | Every latency histogram: count, p50/p90/p95/p99/max (ms) |
| `decision-report.md` | The guide's §20 report, populated from the files above |
| `trace-sample.ndjson` | Sampled traces (frames, or events at `--detail stage`; intents) |
| `resource-timeseries.csv` | Per-second CPU (% of one core), event-loop delay, RSS, heap, GC, cgroup throttling |
| `overhead.json` | A/A instrumentation results |
| `data-quality.json` | Fixture checks (fixture runs) |
| `delay-cost-results.csv`, `delay-cost-segments.csv`, `plan.json` | Delay runs |
| `recording/` | Raw frames, `recording-index.json` with per-segment SHA-256 |

The report never estimates. p95 needs at least 100 samples and p99 at least
1,000; below that it prints the count. Stage percentiles must not be added
together: a dispatch span contains the state, evaluate and risk spans.

### Measurement boundaries

| Metric | From → to |
|---|---|
| `event.age_ns.*` | provider timestamp → `Date.now()` at the first line of the WebSocket callback. Includes clock offset; negative values are kept separately |
| `bar.publication_lag_ns` | bar interval **end** → receipt |
| `frame.parse_ns` | callback entry → `JSON.parse` done |
| `frame.receive_to_done_ns` | callback entry → every event in the frame dispatched through all synchronous handlers |
| `order.receive_to_intent_ns` | frame receipt → intent reaches risk |
| `order.journal_ns` | the awaited durable journal write (fail-closed) |
| `order.receive_to_submit_ns` | frame receipt → immediately before the broker client is called |
| `order.submit_to_response_ns` | broker call → mapped response (null/sim sink offline) |
| `order.submit_to_first_update_ns` | broker call → first order update on the bus |
| `replay.*` (replay runs) | generator lateness, per-frame processing, scheduled → done (corrected for coordinated omission) |

## Invalid market data

Trading runtimes drop unusable messages (one-sided or crossed quotes,
non-positive prices, unparseable timestamps) before they reach prices, marks
or strategies. Drops are logged at the 1st, 10th, 100th, ... occurrence per
kind and code. `MARKET_DATA_INVALID_POLICY=pass` restores the old behaviour.
Benchmark commands follow the same setting unless you pass `--invalid-data`.
To compare code changes like for like, pin it (e.g. `--invalid-data pass`).

## Known caveats

- **Windows**: the OS timer tick (~15.6 ms) dominates event-loop delay and
  paced-replay timing, and the report says so. Use Linux (Docker or EC2) for
  those numbers. Max-throughput runs are fine on Windows but noisy, so compare
  repetitions.
- The A/A gate (< 5% throughput) is evaluated at maximum throughput, which is
  conservative. At live IEX rates the relevant figure is the added µs per frame.
- Live SIP capture needs the corresponding streaming entitlement; a `403`
  indicates the account cannot access that requested feed. This differs from
  historical SIP windows used for backtest fills. IEX quotes can be sparse, so
  expect stale-quote rejections on less liquid symbols.
- Replay steps the application clock (`nowMs()`) to recorded receive times in
  its own process. It refuses to run in a process locked for live trading.

## Tests

`npm run test:unit` includes the benchmark suites (`src/tests/bench`,
`src/tests/core/telemetry*`, `latencyProbe`, `frameRecorder`,
`normalizerValidation`). They need no credentials and send nothing.
