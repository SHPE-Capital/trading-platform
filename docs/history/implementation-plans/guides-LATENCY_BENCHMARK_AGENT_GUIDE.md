> Historical specification archived during the 2026-10-20 documentation refresh.
> It includes proposals and completed tasks; it is not the current operating guide.
> Current documentation: [LATENCY_BENCHMARK_AGENT_GUIDE.md](../../guides/LATENCY_BENCHMARK_AGENT_GUIDE.md).

# Latency benchmark and event-data implementation guide

Reconstructed on October 12, 2026 from the project's earlier benchmarking plan.
This is a functional reconstruction, not a byte-for-byte recovery of the lost file.
Repository observations below were checked against the current checkout on that date.

## 1. Mission and constraints

You are the AI agent responsible for making this platform's latency measurable,
building the minimum missing infrastructure for reproducible benchmarks, and
deciding whether latency optimizations are useful for the intended strategies.

The user wants to explore US equity and ETF strategies that react within seconds,
including intraday long and short positions. The initial market-data entitlement
is Alpaca's free IEX feed. The planned AWS host has **2 vCPUs and 8 GB RAM**.
Python research and inference services are possible, but are not prerequisites.

Answer these questions with measurements:

1. How old is an event when the application can first observe it?
2. How much additional time does our own application consume before an order request?
3. Which stage causes the median delay, the tail delay, or dropped work?
4. Can the host sustain the intended symbols and strategy count during bursts?
5. Do quotes and trades improve decision timing or execution modeling over bars?
6. Does a strategy retain an economically useful result after realistic delays and costs?
7. Which optimizations, if any, change that conclusion enough to justify their complexity?

Deliver a reproducible harness, necessary integration changes, fixtures and tests,
an operating procedure, and an evidence-based decision report. If invoked only
to restore or edit this guide, change documentation only; the instructions below
describe subsequent benchmark and implementation work.

### Completion standard

- [ ] Existing event paths and current deployment are documented accurately.
- [ ] Clocks, timestamps, units and correlation IDs are explicitly defined.
- [ ] Baseline instrumentation works without changing trading decisions.
- [ ] Raw event recording and offline replay are available or their gaps are reported.
- [ ] Sustained, burst and failure tests are reproducible without a broker connection.
- [ ] Local and target-AWS measurements distinguish comparable and confounded runs.
- [ ] Optional paper-order measurements are separated from shadow measurements.
- [ ] A fixed strategy is evaluated over a predeclared delay and cost grid.
- [ ] The final report recommends keeping the design, specific improvements, a slower
  strategy horizon, better data, or further evidence, with reasons.

### Navigation

- [Repository audit](#3-repository-audit-and-integration-map)
- [Timing model](#5-clock-model-and-measurement-boundaries)
- [Tracing schema](#6-event-and-trace-schema)
- [Recording and replay](#8-recording-and-storage)
- [Benchmark matrix](#10-benchmark-matrix)
- [AWS procedure](#12-aws-procedure-for-2-vcpus-and-8-gb-ram)
- [Economic tests](#15-strategy-delay-and-cost-sensitivity)
- [Implementation tickets](#18-implementation-tickets-and-acceptance-tests)
- [Report and handoff](#20-report-template-and-decision-rules)

## 2. Operating modes and boundaries

Implement clearly distinguishable modes, with order submission disabled by default.

| Mode | Input | Execution | Purpose |
|---|---|---|---|
| Fixture | Checked-in synthetic data | Null or deterministic simulated sink | Correctness, CI and timing overhead |
| Recorded replay | A fixed captured dataset | Isolated simulated sink | Repeatable performance and delay tests |
| Live shadow | Authorized live IEX connection | Null sink, no broker orders | Data age, live load and hypothetical signals |
| Local simulation | Cached or streamed data | Local simulated ledger | End-to-end integration without broker orders |
| Alpaca paper probe | Authorized live data | Explicit paper-only order sink | Journal, request and order-update measurements |

Rules for the implementing agent:

1. Read applicable `AGENTS.md` instructions and inspect the working tree first.
2. Preserve unrelated changes. Implement small, reviewable changes with defaults
   that leave ordinary runtime behavior intact.
3. Never switch a benchmark to real-money execution or bypass protected-account rules.
4. Do not expose keys, authentication frames, request headers or private account data
   in fixtures, logs, reports, screenshots or Git commits.
5. Honor the existing one-owner connection and strategy-run ownership mechanisms.
6. Do not launch an additional live stream with the same account without checking
   its entitlement and current owner. Attach instrumentation to the existing owner
   or use an isolated personal-data environment.
7. CPU saturation, network faults and disk-exhaustion tests belong in an isolated
   benchmark environment, not an active shared trading process.
8. Do not remove risk checks, capital reservations, reconciliation, durable order
   journaling, account protections or idempotency to obtain a faster number.
9. Keep recorded replay and its simulated clock in a separate process from trading.
10. Report incomplete observations as incomplete. Do not manufacture market samples,
    successful fills, AWS measurements or a profitable strategy result.

The initial workflow is fixture, recorded replay and live shadow. Paper probes
are a distinct explicit operating choice, with a paper account, bounded order
count, bounded notional, rate limiting, monitored exposure and cleanup.

## 3. Repository audit and integration map

Do not start by adding a second market-data system. Inspect these existing files.
Paths in this guide are relative to the repository root.

| Area | Existing location | Audit objective |
|---|---|---|
| Market-data connection | `backend/src/adapters/alpaca/marketData.ts` | Receive boundary, authentication, subscriptions, reconnects |
| Data normalization | `backend/src/adapters/alpaca/normalizer.ts` | Fidelity, units and precision |
| Market types | `backend/src/types/market.ts` | Quote/trade/bar shape and timestamp semantics |
| Internal events | `backend/src/types/events.ts` | Trace propagation and event ownership |
| Event bus | `backend/src/core/engine/eventBus.ts` | Synchronous dispatch and nested publication |
| State | `backend/src/core/state/symbolState.ts` | State age, rolling windows and allocation |
| Orchestration | `backend/src/core/engine/orchestrator.ts` | State, evaluation, sizing, risk and order paths |
| Strategy contract | `backend/src/strategies/base/strategy.ts` | Fast synchronous `evaluate()` and warm-up |
| Risk | `backend/src/core/risk/riskEngine.ts` | Existing controls and rejection paths |
| Durable execution | `backend/src/core/execution/journaledExecution.ts` | Journal wait before broker submission |
| Broker orders | `backend/src/adapters/alpaca/orderExecution.ts` | HTTP request/response and order-update stream |
| Bootstrap | `backend/src/runtime/bootstrap.ts` | Persistence, snapshots, leases and other subscribers |
| Trading entry point | `backend/src/runtime/paper-trading.ts` | Execution target and shutdown |
| Time abstraction | `backend/src/utils/time.ts` | Simulated-clock override and live lock |
| Event replay | `backend/src/core/replay/replayEngine.ts` | Reusable behavior and timing limitations |
| Cached-bar replay | `backend/src/adapters/replay/replayBarFeed.ts` | Bar-only input versus recorded event replay |
| Backtest registration | `backend/src/core/backtest/strategyFactory.ts` | Supported strategy types |
| Local environment | `docs/guides/local-development.md` | Data access and isolated execution |
| Deployment | `deploy/docker-compose.prod.yml` | Contention, limits, images and logging |

### Checked observations to preserve

- The current Alpaca adapter already subscribes to **quotes, trades and bars** and
  publishes normalized events. The task is not simply changing a bar subscription.
- The orchestrator evaluates relevant strategies on quote, trade and bar events.
  Confirm individual strategies' own event gating before changing frequency.
- The event bus dispatches handlers synchronously. An expensive handler can delay
  subsequent handlers and the next WebSocket callback.
- Existing quote/trade `ts` values use milliseconds while `isoTs` retains a string.
  These fields alone do not provide complete receive-to-order tracing.
- Existing quote normalization models one exchange field, while the provider quote
  schema distinguishes bid and ask venues. Its size-unit assumptions need review.
- Bar updates can overwrite a state's `latestMid` with a bar close. A quote-based
  benchmark must distinguish a current quote mid from a bar-derived fallback.
- Order submission has a deliberate awaited journal write before the broker call.
  Instrument this wait separately; it is not optional analytics persistence.
- The backtest factory currently registers `pairs_trading`. Other strategy types
  require integration before claiming they use the common backtest path.
- Existing replay components are useful starting points, not proof that full-fidelity
  recorded quote/trade replay and latency injection already work.
- Deployment colocates API, paper trading and a backtest worker. The backtest worker
  has a one-CPU limit; this still creates contention on a two-vCPU host.
- Local development defaults to `EXECUTION_TARGET=sim`. Follow the local guide for
  personal data access; never work around its club-account protections.

Write an audit artifact containing the inspected commit, files, current capabilities,
missing capabilities and proposed edits. Recheck these observations if the code changed.

## 4. Data semantics and capability preflight

### Three different inputs

- A **trade** describes an executed transaction.
- A **quote** describes offered prices and sizes at an instant; it is not a fill.
- A **bar** summarizes activity over an interval. It cannot reconstruct the event
  ordering, spread path or order queue inside that interval.

Free IEX is a single-exchange view, not consolidated market coverage. Explicitly
record the feed instead of relying on a default. IEX quotes are not a substitute
for the national best bid and offer, and IEX volume is not total market volume.
Source: [Alpaca market-data FAQ][alpaca-faq].

A real-time feed is not a zero-latency feed. Event timestamp precision also does
not establish delivery speed or clock accuracy. Do not promise an exchange-to-host
latency, throughput capacity, strategy edge or HFT capability without evidence.

### Preflight checklist

- [ ] Record actual feed endpoint, entitlement, account role and connection owner.
- [ ] Confirm permitted channels, symbols, concurrent connections and request limits.
- [ ] Verify the server's subscription response, not just the client's desired set.
- [ ] Check available historical quotes/trades and their feed/date coverage.
- [ ] Select a small initial liquid universe, for example SPY and QQQ, then expand
  using measured event rates. Example symbols are workload candidates, not signals.
- [ ] Record session calendar, UTC storage and `America/New_York` session labels.
- [ ] Confirm correction/cancel handling, bar revision policy and trade-condition policy.
- [ ] Test outside market hours with fixtures or the provider test stream, while
  labeling that result as protocol testing rather than market-load measurement.

Read the current [streaming protocol][alpaca-stream] before implementation.
Messages may contain batches. Treat authentication, subscription errors, slow-client
disconnects and reconnects as observable states. Do not assume a fixed connection
limit applies to every subscription; the local guide documents this project's
single-stream operating assumption.

### Normalization fidelity gate

Preserve the provider timestamp string and raw schema alongside normalized values.
Review separate bid/ask venue fields, conditions, tape, trade IDs and quote-size
units against the [stock stream schema][alpaca-stock]. Do not silently treat a
round-lot quantity as a share quantity. If conversion is needed, make its unit and
lot-size assumption explicit and test it.

Validate positive finite prices, nonnegative sizes, zero-denominator behavior,
locked/crossed quotes, missing fields and unknown message types. Keep raw rejected
records and reason counts. Quarantine unusable data rather than silently repairing
it into plausible prices. Correctness fixes get their own versioned baseline.

The same source documents bar interval timestamps and revisions. Compare bar
arrival with the interval end, not just the interval start. An approximately
minute-old bar-start timestamp does not demonstrate a minute of network latency.
Preserve corrections and cancellations for later interpretation; do not rewrite
the past information set as if the correction had arrived earlier.

## 5. Clock model and measurement boundaries

Use two clocks for different questions.

| Clock | Role | Restriction |
|---|---|---|
| UTC wall clock | Compare local observation with provider event time | Subject to synchronization error, resolution and adjustments |
| Process monotonic clock | Measure durations between local stages | No subtraction across independent processes or hosts |

Use `process.hrtime.bigint()` for Node durations, retaining integers until reporting.
Use a real local wall clock for receipt time. The application's `nowMs()` can be
overridden by replay, so it must not be the benchmark's monotonic stopwatch.
Reference: [Node process timing API][node-process].

Preserve nanosecond timestamp values as decimal strings or safe integer pairs in
JSON. JavaScript `Number` cannot exactly represent epoch nanoseconds. `Date` parsing
does not preserve all submillisecond provider digits. A high-resolution timer does
not make a wall-clock anchor accurate to nanoseconds.

### Define the boundaries before collecting results

| Name | Exact observation |
|---|---|
| `provider_event_time` | Provider timestamp, retaining original string and semantic type |
| `receive_wall` | Wall time at the first line of the WebSocket message callback |
| `receive_mono` | Monotonic time at that same application boundary |
| `parse_start`, `parse_end` | Frame decoding and JSON or alternative-format parsing |
| `normalize_start`, `normalize_end` | One event's conversion and validation |
| `dispatch_start`, `dispatch_end` | Event-bus publication, including synchronous handlers |
| `state_start`, `state_end` | Relevant state update |
| `evaluate_start`, `evaluate_end` | One strategy evaluation, including no-action cases |
| `intent_ready` | A resulting order intent is constructed |
| `risk_start`, `risk_end` | Required sizing/risk/reservation path, with subspans as useful |
| `journal_start`, `journal_end` | Awaited durable order recording |
| `submit_start` | Immediately before invoking the broker HTTP client |
| `response_headers` | HTTP response available, if exposed by the client |
| `response_complete` | Response body parsed and mapped to an order |
| `order_update_receive` | First callback boundary for a broker order-update message |
| `fill_applied` | Fill normalized, deduplicated and applied to internal state |

The receive boundary is **application-visible receipt**, not NIC arrival. Kernel,
TLS, WebSocket decoding and event-loop scheduling can precede it. Do not call
`submit_start` the exact wire-send time; DNS, connection setup and client queues
may occur after that boundary. Add lower-level measurements only if justified.

### Required derived metrics

```text
observed_event_age = receive_wall - provider_event_time
parse_duration = parse_end - parse_start
normalization_duration = normalize_end - normalize_start
strategy_duration = evaluate_end - evaluate_start
application_to_submit = submit_start - receive_mono
journal_duration = journal_end - journal_start
submit_to_response = response_complete - submit_start
submit_to_update = order_update_receive - submit_start
receive_to_fill_application = fill_applied - receive_mono
bar_publication_lag = receive_wall - bar_interval_end
```

All duration subtractions use the same clock domain. `observed_event_age` combines
upstream processing, transport, local scheduling and clock error; it is **not a
measurement of pure one-way network latency**. Compare trades, quotes and bars
separately. A provider trade-update timestamp has its own semantics.

For each event compute an actual critical-path duration. Do not sum stage p99s
to claim an end-to-end p99. Nested synchronous dispatch spans overlap; parent and
child spans must not be added as independent work. Async stages can overlap too.

### Clock quality

Record synchronization service, source, offset estimate, uncertainty where available,
last update, wall-clock jumps, host boot ID and process ID. Capture wall/monotonic
anchors periodically. Split runs across clock discontinuities. Keep negative event
ages in a separate diagnostic distribution and investigate them rather than
clipping them to zero. Mark external-age comparisons inconclusive when uncertainty
is material to the difference being tested.

On EC2 verify the actual configured time service. [AWS time synchronization][aws-time]
describes options; do not assume every instance supports the same precision clock
or that a managed time source gives zero offset.

## 6. Event and trace schema

Introduce a small optional metadata envelope or sidecar tracing structure. Preserve
existing strategy and business timestamps. Do not change every strategy signature
solely to transport measurements if an envelope can preserve compatibility.

Every captured event should identify:

```text
schema_version, benchmark_run_id, experiment_id
host_id, boot_id, process_id, clock_domain_id
connection_id, connection_epoch, frame_sequence, event_index_in_frame
event_id, parent_event_id, correlation_id
feed, source_endpoint_label, symbol, event_kind
provider_timestamp_raw, provider_timestamp_semantics
provider_epoch_ns_string, receive_wall_epoch_ms
receive_monotonic_ns_string, normalization_version
raw_frame_reference, normalized_payload_reference
strategy_id, strategy_version, config_hash (when evaluated)
intent_id, client_order_id, broker_order_id (when available)
stage_name, stage_start_ns_string, stage_end_ns_string
status, rejection_reason, error_class, sampled, sample_probability
```

Use one frame identity for all messages in a batch and an event index within it.
Stamp reception once at callback entry; a later event in that frame must retain
the original receive boundary, so earlier work in the batch appears as delay.
Do not allocate a fresh receive timestamp after parsing every element.

Record evaluation outputs even when no signal is created. Trace risk rejections,
cooldowns, queued intents and dropped work. A signal-only sample hides the cost
of the majority of evaluations.

Propagate correlation through nested bus publication and async order processing.
Capture metadata before crossing an async boundary; never use a shared mutable
"current event" variable to correlate concurrent requests. Link by immutable IDs.
Multiple signals from one event and multiple events contributing to one signal
need explicit relationships rather than a forced one-to-one join.

Separate a public report from restricted raw order/account artifacts. Use a
documented pseudonymous account label where a join is needed. Authentication
and subscription control frames must be filtered or redacted before recording.

### Run manifest

Store one manifest per immutable run, containing:

- Git SHA, dirty state, changed-file digest and build/image identity.
- Host, instance type, region/AZ, OS, architecture, kernel and runtime versions.
- Actual CPU/memory/container limits, storage and instance credit mode if relevant.
- Feed, symbols, channels and acknowledged subscriptions.
- UTC start/end, session segment, clock-quality summaries and warm-up policy.
- Strategy/configuration versions and number of registered/enabled strategies.
- Workload source, hashes, event counts, speed and burst schedule.
- Instrumentation configuration, sampling, trace overhead and output locations.
- Intended execution mode, enabled order gate and isolation boundaries.
- Random seed, delay model, cost model, repetitions and stop conditions.
- Run validity, gaps, drops, reconnects, errors and reasons for exclusion.

## 7. Instrumentation design and overhead

Begin with the smallest useful trace points: callback receipt, parse, normalization,
state/evaluation, journal, submission and response. Add finer spans after the
baseline identifies a need. Keep span names and metric units stable.

Use in-memory counters and bounded histograms, periodically exported. Use bounded
queues for detailed traces. Avoid per-event console output, per-event database
inserts, growing arrays or synchronous compression in the critical path.

Required aggregate metrics:

- Counts and rates by event type, symbol and connection epoch.
- Frame sizes, events per frame and interarrival gaps.
- p50, p90, p95, p99, maximum, sample count and measurement interval per latency.
- Histogram buckets and deadline-miss counts, not just averages.
- Event-loop delay and utilization, process CPU, RSS, heap and GC observations.
- Queue depth, oldest queued age, capacity, high-water mark and overflow count.
- Error, reconnect, timeout, rejected-event, rejected-order and uncorrelated-trace counts.
- Recorder bytes, write latency, disk free space and archive throughput.

Use bounded metric dimensions. Per-order IDs belong in trace records, not labels
on a long-lived metrics series. Export histogram counts so summaries can be merged
correctly; averaging per-minute p99 values does not produce a session p99.

Node exposes event-loop measurement through [performance hooks][node-perf]. Check
units, resolution and API behavior against the deployed Node version. A resolution
setting is not an accuracy guarantee. Keep profiling runs separately labeled.

### A/A overhead experiment

1. Replay an identical dataset with tracing disabled after a declared warm-up.
2. Replay with counters and histograms only.
3. Replay with the intended production trace sampling.
4. Replay with full recording/tracing for diagnostic comparison.
5. Repeat each configuration at least three times in interleaved order.
6. Compare throughput, tails, CPU, RSS and deterministic strategy outputs.
7. Reduce overhead or explain its material effect before using instrumented numbers
   to choose an optimization. Never silently subtract an estimated overhead.

Suggested initial overhead gate: less than 5% throughput degradation and no
material deadline-miss increase at the planned workload. This is a provisional
engineering criterion, not a measured result or a provider guarantee.

## 8. Recording and storage

Capture enough data to rerun both processing and strategy experiments.

1. Record raw market-data frames with frame ID, receive clocks and connection epoch.
2. Record normalized events linked to those frames and normalization version.
3. Record strategy decisions and order lifecycle separately from market data.
4. Save acknowledged subscriptions, disconnect intervals and protocol errors.
5. Save a manifest and hashes after rotating and finalizing each segment.

A practical first format is append-only NDJSON with decimal-string timing fields,
rotated by size or time. Compression can run off the critical path. Convert to
Parquet for Python analysis later if worthwhile; a new database is unnecessary
for the first baseline. Store large datasets outside ordinary application tables
and keep references/checksums in the control database when needed.

Document crash semantics: queued, written, flushed and durable are different
states. A successful enqueue is not proof the event survived a power loss. A raw
capture file may tolerate a documented final partial record; an order journal
has stronger requirements and remains independent of bulk market recording.

### Bounded resources and loss accounting

- Limit queue capacity, segment size, file count and total disk use.
- Report raw frames received, decoded events, accepted events, quarantined events,
  queued records, records written and records dropped.
- If a queue overflows, increment a persistent counter and record the affected
  sequence interval when possible. Label the dataset incomplete.
- Define whether recording failure halts a research run or continues with an
  invalidated capture. Do not let optional recording failure silently bypass
  trading controls or block the event loop indefinitely.
- Keep a high-water alarm and an emergency low-disk policy.
- Exclude raw data, secrets and large run outputs from Git. Commit only small
  sanitized fixtures, schemas, code and summary artifacts appropriate for the repo.

Measure bytes per second on the intended universe, extrapolate storage per session,
and set retention before a multi-day capture. Do not assume IEX event activity is
constant throughout the session.

Internal accounting can establish that this application did not drop an observed
frame. It cannot establish completeness of the upstream exchange stream when the
provider does not expose an applicable end-to-end sequence guarantee. Label that
distinction in the report.

## 9. Recorded replay and synthetic workloads

Build on existing replay code where practical, but provide two explicit modes.

### Processing replay

Purpose: measure how fast the application processes a known stream.

- Preserve frame boundaries and receive order.
- Support real-time pacing, fixed acceleration and maximum-throughput runs.
- Record intended and actual delivery times to expose load-generator lateness.
- Measure latency from scheduled availability as well as callback entry. Otherwise
  a saturated generator can understate backlog through coordinated omission.
- Produce the same decision/output checksum on repeated deterministic runs, apart
  from explicitly excluded wall-clock IDs and telemetry.
- Keep replay external to the process under test for host-level capacity tests,
  or document when generator and consumer intentionally share CPU.

### Strategy and execution replay

Purpose: test what decisions and execution remain possible as latency increases.

- Deliver information in original local observation order, not retrospectively
  sorted into provider timestamp order.
- Track original availability and simulated availability separately.
- Use a discrete-event scheduler for data arrivals, decisions, order arrivals,
  cancels and fills. Do not simulate a delay by merely changing a timestamp label.
- At simulated order arrival, use the latest valid observable quote at that time.
  Never fill from a quote or revised bar that becomes available later.
- Retain gaps, late events and correction arrival times.
- Require clean state/reset and explicit warm-up for each repetition.
- Put simulated clock changes in a dedicated process and respect the live-clock lock.

Event time may be useful for feature windows, but receive time governs what the
strategy knew. For multi-symbol features, preserve each symbol's availability.
Specify how late events affect state instead of silently reordering history.

### Small checked-in fixture suite

- A frame containing several quotes/trades/bars.
- Two events with identical provider timestamps and distinct receive positions.
- Submillisecond timestamps that differ after the third fractional digit.
- Missing/zero sizes, locked/crossed quotes and unusable prices.
- Out-of-order provider times, duplicates, corrections and cancellations.
- A bar arrival followed by a fresher quote and a later bar revision.
- A disconnect, reconnect and acknowledged resubscription.
- A large batch and a short high-rate burst.
- Risk rejection, cooldown, queued intent and no-signal evaluation.
- Journal failure, HTTP timeout, late acknowledgment and partial fill.

Synthetic rates are workload parameters. Label them synthetic rather than calling
them typical Alpaca traffic. Calibrate a second fixture against measured rates.

## 10. Benchmark matrix

Keep an immutable baseline before optimizing. Specify the fixed universe, strategy
set and intended reaction deadline in each run. Holding duration and reaction
deadline are different variables: a 30-second position may still need fast entry.

| Dimension | Initial values or treatment |
|---|---|
| Input | Bars only, quotes only, trades only, combined quotes/trades/bars |
| Universe | 2 symbols, then 5, 10 and a justified entitlement-compatible target |
| Strategies | Null evaluator, one simple strategy, intended full strategy set |
| Pacing | Recorded 1x, then 2x/5x/10x, plus explicit bursts |
| Session segment | Open, ordinary midday, close, unusual high-activity period if observed |
| Persistence | Counters only, recording, ordinary operational persistence |
| Host | Local machine and actual 2-vCPU/8-GB AWS environment |
| Contention | Isolated engine, normal stack, scheduled analytics/backtest interference |
| Inference | None, local simple model, optional Python service |
| Execution | Null/simulated sink, then separately bounded Alpaca paper probe |
| Network | Ordinary connection, controlled degradation in an isolated environment |

### Recommended run sequence

1. Verify fixtures and timing math with no external services.
2. Establish normalization and event-processing correctness.
3. Capture a short live shadow interval and inspect its integrity.
4. Run a 15–30-minute pilot on the target host before a full session.
5. Record at least three representative full sessions if access and time permit.
   Include opening and closing activity; three sessions are an initial operational
   sample, not a strategy profitability certification.
6. Replay fixed intervals on both hosts with the same code, settings and data hashes.
7. Increase event rate until a declared deadline, loss or stability criterion fails.
8. Run the normal stack to quantify contention.
9. Run explicit failure cases and recovery checks.
10. Evaluate a frozen strategy's delay/cost sensitivity before pursuing major tuning.

For each replay condition, use a declared warm-up and at least three measured
repetitions. Keep cold start, authentication, warm-up and steady-state intervals
separate. Report sparse p99 estimates with counts instead of false precision.

## 11. Local setup and baseline execution

Use `docs/guides/local-development.md` as the setup source of truth. Current
repository-root commands are:

```sh
npm install
npm run setup
npm run doctor
npm run dev:stack
```

Node.js 22+ and Docker are documented prerequisites. Prepare cached bars ahead of
time for a credential-free local simulated run. The cache-pull script is currently
in the backend package; follow its documented invocation rather than assuming a
root `data:pull` script exists.

The local stack defaults to simulation. Live IEX data requires the documented
personal data credentials and explicit local streaming configuration. Alpaca paper
execution is a different explicit setting. Check the effective mode in the run
manifest and startup log before interpreting order metrics.

### Baseline procedure

1. Record commit, dirty state, software versions and machine characteristics.
2. Check the manifest contains no secrets.
3. Run the fixture suite and verify trace joins and units.
4. Run a no-strategy replay to measure parser/state overhead.
5. Run a deterministic simple strategy with a null order sink.
6. Repeat with normal instrumentation and optional recording.
7. Repeat with the intended strategy count and symbol universe.
8. Save counts, histogram summaries, resource metrics and representative traces.
9. Confirm no broker request was made in fixture/replay/shadow modes.
10. Write a baseline summary before changing performance-sensitive code.

Do not accidentally start the combined development command's real-trading process
for a benchmark. Use the documented isolated stack or explicit entry point whose
effective execution sink has been verified.

## 12. AWS procedure for 2 vCPUs and 8 GB RAM

The resource specification does not identify an instance family, region, CPU
architecture, sustained CPU allowance or network behavior. Inspect the actual
instance rather than assuming a particular T-series or guaranteed latency.

### Before the run

- [ ] Record instance type, CPU architecture, region/AZ and image digest.
- [ ] Record available memory, storage capacity and container resource settings.
- [ ] Confirm clock synchronization and inspect its offset diagnostics.
- [ ] Confirm the benchmark uses a paper/null sink and the intended IEX owner.
- [ ] Identify API, worker, proxy, monitoring and database workloads on the host.
- [ ] Prepare a disk-retention limit and a way to pause only this benchmark.
- [ ] Confirm access to runtime logs without exposing environment secrets.
- [ ] Check whether the instance is burstable and collect CPU-credit metrics if so.

### Resource strategy

Start with one authoritative market-data connection and in-process state/evaluation.
Keep bulk analytics and neural-network training out of the trading critical path.
Managed Supabase remains the repository's documented deployment default; do not
add a full self-hosted database stack to the small host merely to benchmark latency.

Measure the isolated engine first, then the real deployed service mix. A one-CPU
backtest-worker cap still allows it to compete for CPU, memory bandwidth, disk and
network. Schedule heavy jobs separately or isolate them if the measured tail
impact is material. Do not stop shared production jobs as an unannounced experiment.

Interpret CPU correctly: one fully occupied event-loop thread may exhaust its
core while aggregate utilization on a two-vCPU machine looks only half full.
Watch event-loop delay, run-queue pressure and container throttling alongside CPU.

Record RSS, heap, major GC pauses, queue age and disk growth throughout a sustained
run. A short benchmark may miss memory growth or depleted CPU credits. For a
burstable instance, correlate tails with credit balance and surplus usage; consult
[AWS CPU-credit monitoring][aws-credits] rather than assuming burst performance persists.

### Practical diagnostics on a Linux benchmark host

These are diagnostic examples, not new benchmark commands supplied by the repo.
Use available tools; do not install packages into a trading host without its
ordinary maintenance process.

```sh
date -u
uname -a
lscpu
free -m
df -h
docker stats --no-stream
chronyc tracking
chronyc sources -v
```

`chronyc` is relevant only if chrony is the configured service. Preserve the
diagnostic outputs with the run, redact identifiers where needed, and note tools
that were unavailable. Collect time-series metrics as well as these snapshots.

## 13. Feed, network and regional comparisons

Separate application capacity from external delivery behavior.

For application comparisons, replay identical captured frames on each host.
For feed comparisons, collect external-age distributions with clock diagnostics,
session segment, rates, connection epochs and subscription acknowledgments.

Do not:

- Treat ICMP ping, DNS lookup time or WebSocket heartbeat RTT as market-event age.
- Divide RTT by two and report it as measured one-way exchange latency.
- Guess the provider's physical matching/data-center location from an IP or URL.
- Compare an opening burst on one host with quiet midday traffic on another as
  if the host alone caused the difference.
- Open unauthorized simultaneous account connections to get a paired result.

If evaluating regions, use an existing authorized environment and a controlled
plan. Sequential region tests are confounded by market conditions and routing;
report that limitation. Concurrent identical-event comparisons require entitled
connections or a shared fan-out whose own transport and clocks are measured.
Do not confuse shared fan-out delay with direct provider delivery.

Measure cold and warm HTTP request paths separately. Verify client connection
reuse, DNS/TLS setup and timeout behavior from the actual client/runtime. Optimize
connection handling only after measuring it; do not assume adding a custom client
will improve the path.

## 14. Paper-order benchmark

Run this phase only in its explicit paper-probe mode. It supplements the shadow
benchmark; it is not a prerequisite for measuring parsing or strategy evaluation.

### Probe controls

- Dedicated run identity and reviewed paper-only account/endpoint.
- Small, configured maximum order count, rate, notional and open exposure.
- Existing risk, journaling, idempotency and reconciliation enabled.
- Unique client-order ID linked to run, intent and parent market event.
- Monitoring owner, stop condition and bounded cleanup/reconciliation procedure.
- No blind retry of an ambiguous submission timeout. Reconcile by the existing
  client-order ID before deciding whether a new action is permitted.

Trace journal wait, HTTP invocation, response body, asynchronous order updates,
partial fills, cancel requests and final reconciled state. An update can arrive
before the corresponding REST response is processed; joins must support that.

Distinguish submitted, acknowledged, rejected, canceled, partially filled and fully
filled. A quick acknowledgment does not mean a quick fill. Report time-to-first-fill,
time-to-full-fill and unfilled/canceled counts separately. Do not compute a fill
latency distribution using only successes without reporting the excluded orders
and observation horizon. Marketable and resting-limit orders are different tests.

Report order quantity, side, spread, quote age, order type and time in session with
the measurement. Use signal-time and order-arrival reference prices explicitly for
slippage or implementation-shortfall calculations. Distinguish signed buy/sell costs.

Alpaca paper fills are simulated and omit important real-execution effects,
including latency-related slippage, queue position and market impact. Paper matching
can use NBBO even when the signal feed is IEX. Therefore paper measurements validate
integration and observed simulator behavior, not live fill quality or an HFT edge.
Source: [Alpaca paper-trading assumptions][alpaca-paper].

A nonmarketable order is not an exchange network probe with a guaranteed completion
time. Preserve rejected and unfilled observations rather than forcing executions
solely to populate a favorable benchmark table.

## 15. Strategy delay and cost sensitivity

This phase connects engineering measurements to whether faster processing matters.
Use one fixed baseline strategy with exact, versioned rules. It need not be
profitable; a negative result is informative. Separate alpha research from a
latency experiment so changing both does not hide the cause of an improvement.

### Experimental grid

Begin with incremental decision/order delays such as:

```text
0, 5, 10, 25, 50, 100, 250, 500, 1000, 2000 milliseconds
```

These are proposed sensitivity points, not claimed Alpaca delays. Include measured
median/tail cases and longer stress cases. Later use an empirical delay distribution
and burst-correlated jitter. Explain whether the injected delay represents delayed
information, processing, order submission or cancellation.

Do not double-count existing feed delay: a recording already contains the local
arrival sequence. Define the zero-increment baseline and add only the intended
extra delay. To compare information latency independently, create a separate
explicit scenario with its own availability model.

At every delay, report:

- Signal count, order count, completed/partial/unfilled trades and timeouts.
- Gross and modeled-net P&L, capital basis, return and maximum drawdown.
- Turnover, exposure, holding duration and long/short results where meaningful.
- Entry/exit price movement, adverse selection and deadline misses.
- Cost assumptions, unavailable liquidity assumptions and stale-quote exclusions.
- Results by day/session regime, sample size and uncertainty.

### Execution model requirements

For marketable orders, use a documented bid/ask crossing model at simulated arrival,
with spread, fees and a slippage stress allowance. Short sales use the correct
side and reviewed feasibility assumptions. Include costs for both legs of pairs.

IEX top-of-book does not reveal the full executable market or the order queue.
Label any resulting execution model as an approximation. Do not infer that a touch
guarantees a passive limit fill or that displayed quantity permits arbitrary fills.
Use conservative and optimistic scenarios where a unique fill path is unknowable.

Minute bars cannot establish the ordering of a stop and target inside a minute.
Use documented conservative assumptions or finer data; do not invent an intrabar
path. Quote/trade recording improves observability but does not create Level-2
depth, queue priority or consolidated coverage.

### Research discipline

Predeclare the strategy, symbols, date splits, cost scenarios, delay grid and
selection criterion. Keep a chronological development window and an untouched
evaluation window. Log every configuration tested. Do not choose a different
"best" strategy at every delay and attribute the resulting curve to latency alone.

Compare a simple baseline before adding neural networks. A faster negative-edge
strategy is still negative after costs. Report a break-even delay only where the
observed curve supports one; otherwise state that it is not established.

## 16. Optional Python inference service

Add Python only when a specific model and experiment justify it. Train offline
on separate compute or during a period isolated from trading. Start with a small
CPU model and compare a local/in-process alternative before adding network services.

The current `IStrategy.evaluate()` contract is synchronous and nonblocking. Do not
insert awaited HTTP inference into it. Choose a reviewed approach such as
asynchronously precomputing model outputs into a cache, with each output linked
to its feature snapshot and permitted decision time. A new async orchestration
contract is a separate design change with ordering and timeout tests.

Define the service contract:

- Request ID, symbol, feature version, feature snapshot identity and availability time.
- Model/artifact version, input schema, lookback and missing-input policy.
- Maximum permissible output age and end-to-end timeout.
- In-flight limit, bounded request queue, cancellation and restart behavior.
- Output score, output validity, computation timestamps and error classification.
- No-action fallback for stale, missing, failed or mismatched predictions.

Measure serialization, IPC or HTTP, queueing, model compute and response handling
separately. Cross-process monotonic clocks are not directly subtractable; use local
durations, round trips and explicit clock/availability mapping. Warm-up and cold
model-load cost are separate observations.

Limit inference worker count and math-library thread pools on a two-vCPU host.
Avoid a worker process for every symbol. Compare model-disabled and model-enabled
replays under identical load, including stale-output behavior and strategy results.
Batching is a latency-throughput tradeoff, so measure it rather than assuming it helps.

## 17. Optimization order and stop rules

Make one material change at a time. Compare fixed workloads and preserve the
baseline. Require correctness and output-equivalence checks for performance changes;
if semantics deliberately change, treat that as a separate strategy/data experiment.

| Priority | Candidate | Evidence required |
|---|---|---|
| 1 | Timestamp, unit, stale-data or trace-join fixes | Incorrect baseline or invalid observations |
| 2 | Remove unnecessary synchronous logging and bulk analytics work | Measured handler or event-loop cost |
| 3 | Bound windows/queues and reduce repeated scans or allocations | CPU, GC, memory or backlog evidence |
| 4 | Avoid duplicate evaluations and compute features incrementally | Same semantics with demonstrable redundant work |
| 5 | Schedule/isolate backtest and training load | Tail latency correlates with colocated jobs |
| 6 | Improve measured client connection handling | Cold setup or connection queues dominate |
| 7 | Review journal locality/latency without weakening durability | Journal wait dominates useful action budget |
| 8 | Worker or inference process with bounded IPC | CPU-bound work justifies communication overhead |
| 9 | Host/region/feed change | External age, resource limits or coverage dominate |
| 10 | More invasive serialization/runtime redesign | Cheaper changes fail the agreed latency/economic target |

Quotes may be coalesced only if a specific strategy's semantics permit retaining
the latest state. Keep raw recording and coalescing counters, and test the changed
information path. Do not drop trades used by flow/volume features or reorder order
lifecycle events to make a throughput result look better.

Do not begin with kernel bypass, custom TCP stacks, language rewrites, GPU inference
or exchange-colocation claims. First identify a measured bottleneck and its actual
economic effect. Avoid introducing a message broker solely because microservices
sound faster; every hop has serialization, ordering and operational costs.

Stop tuning when local latency is comfortably inside the strategy's measured useful
budget, the expected improvement is below measurement uncertainty, or an external
data/execution limitation dominates. Preserve the result as a decision, not a failure
to find another optimization.

## 18. Implementation tickets and acceptance tests

The following are **proposed additions**, not claims that these scripts or modules
already exist. Adapt names to repository conventions and keep the scope reviewable.

### Ticket A: audit and capability report

- Inventory the files in section 3 and current deployment resources.
- Verify data entitlement, subscriptions, clocks and execution isolation.
- Identify existing recorder/replay/metrics code before adding duplicates.
- Deliver `audit.md` and a short ordered implementation plan.
- Acceptance: another engineer can distinguish existing behavior from proposed work.

### Ticket B: optional trace context and metric primitives

- Add bounded histograms/counters and optional trace context under an appropriate
  core telemetry or benchmark module.
- Capture local receipt before parsing and propagate frame/event identities.
- Add spans around evaluation, risk, journal and broker request boundaries.
- Export structured summaries without per-event console output.
- Acceptance: disabled instrumentation leaves behavior unchanged; units and nested
  span accounting are tested; no-signal and rejected paths are observable.

### Ticket C: normalization fidelity

- Preserve raw provider fields and validate bid/ask venues and size units.
- Add precision-preserving event-time parsing alongside existing business timestamps.
- Handle or explicitly quarantine unknown/correction/cancel/revision messages.
- Define stale/crossed/invalid data behavior and version the normalizer.
- Acceptance: checked-in fixtures demonstrate exact submillisecond distinctions,
  unit correctness and no accidental consolidated-feed assumptions.

### Ticket D: bounded recorder

- Add optional raw and normalized recording, rotation, manifest and hashes.
- Exclude authentication secrets and implement bounded backpressure behavior.
- Record explicit loss/gap counters and crash-recovery semantics.
- Acceptance: a fixed capture round-trips, a truncated final record is handled as
  documented, disk/queue exhaustion is visible and no unbounded growth occurs.

### Ticket E: replay and load generator

- Reuse the existing replay abstractions where useful.
- Support received-order frame replay, pacing, acceleration and scheduled bursts.
- Add a deterministic simulated sink and a null sink that cannot submit orders.
- Track generator lateness, queue age and per-stage timings.
- Acceptance: repeated runs have equivalent decisions, immutable input hashes,
  explicit late/corrected-event handling and no trading-clock contamination.

### Ticket F: strategy delay simulator

- Schedule data, decisions, order arrivals, cancels and fills explicitly.
- Support fixed and empirical delay scenarios with reproducible seeds.
- Report gross/net results, fill limitations and cost sensitivity.
- Acceptance: tests prove no fill or decision uses future unavailable information,
  delay injection changes actual execution timing, and costs use correct sides.

### Ticket G: runtime health and AWS baseline

- Add low-overhead event-loop, CPU, memory, queue and recorder metrics.
- Publish a clear benchmark profile and manifest on the actual AWS host.
- Run sustained/burst/normal-stack comparisons and save outputs.
- Acceptance: report identifies host/resource/clock conditions and any gaps rather
  than equating a local replay result with AWS live performance.

### Ticket H: optional bounded paper probe

- Use the existing paper execution sink and durable journal.
- Join REST responses and stream updates by stable IDs, including out-of-order arrival.
- Bound order rate/count/notional and implement reconciliation/cleanup.
- Acceptance: no live endpoint, no blind ambiguous retry, all submitted orders have
  accounted-for terminal or explicitly unresolved states at the report cutoff.

### Ticket I: evidence-based optimization and handoff

- Implement only improvements supported by the baseline and economic sensitivity.
- Repeat comparable runs and summarize costs, benefits and residual uncertainty.
- Document exact commands, fixtures, modes, flags and expected artifacts.
- Acceptance: a second engineer can reproduce the result and explain why additional
  latency work is or is not recommended.

### Suggested command interface after implementation

Expose a small documented CLI or package scripts. For example:

```text
bench:fixture        Synthetic correctness and processing benchmark
bench:capture        Authorized live-shadow recording, orders disabled
bench:replay         Fixed dataset replay with pacing and workload controls
bench:delay          Strategy execution replay over the delay/cost grid
bench:paper          Explicitly gated paper-only order probe
bench:report         Summaries, plots and decision report from saved artifacts
```

Do not publish example invocations as runnable until these commands exist. Document
required options for input/output, duration, symbols, strategy/config, seed, mode,
maximum queue size, recording limits, and order-probe limits. Fail startup on
incompatible modes or missing safety parameters rather than silently choosing defaults.

## 19. Verification and failure scenarios

Run checks appropriate to changed code. Existing backend scripts include build,
typecheck, lint and Jest tests; inspect `backend/package.json` before invoking them.
Suggested ordinary checks from the backend directory are:

```sh
npm run build
npm run typecheck
npm run lint
npm run test:unit
```

Use targeted tests during implementation, followed by the relevant required checks.
Report preexisting failures separately from new regressions. Live integration tests
are not substitutes for deterministic timing and correctness fixtures. Do not
activate real credentials or paper orders as a side effect of the default unit suite.

### Required scenarios for the implemented benchmark

- [ ] Disabled instrumentation preserves ordinary strategy/order behavior.
- [ ] Timing subtraction rejects mixed clock domains and preserves integer precision.
- [ ] Batched events share receipt time but retain individual processing spans.
- [ ] Nested and asynchronous publication preserve correct correlations.
- [ ] Unknown/invalid data does not crash the stream or become a valid signal silently.
- [ ] Correction, cancellation and revision availability do not leak future information.
- [ ] Large bursts produce visible backlog/deadline misses without unbounded memory.
- [ ] Recorder overflow and full-disk conditions are explicit and accounted for.
- [ ] Disconnection and reconnect gaps remain in the run manifest.
- [ ] Stale quotes and mismatched model outputs follow the configured no-action policy.
- [ ] The replay clock cannot override a live/paper trading process.
- [ ] Durable journal failure prevents broker submission.
- [ ] Ambiguous HTTP timeout does not create duplicate orders through blind retry.
- [ ] Partial fills, late updates and cancels reconcile correctly.
- [ ] Restart recovers or explicitly refuses inconsistent state before resuming orders.
- [ ] Sampled telemetry declares its denominator and loss counts.
- [ ] A report with insufficient data says so instead of declaring a passing latency.

### Predeclare stop conditions

Set limits for runtime, resource use, queue age, disk availability, unreconciled
orders and unexpected endpoint/account identity. Choose values from the actual
environment and record them in the manifest. A benchmark stop is an observation
with a reason, not a result to remove from the report.

For initial one-second-reaction exploration, a possible provisional application
target is receive-to-submit p95 at or below 10 ms and p99 at or below 25 ms under
the intended workload, including required journaling. These are planning examples,
not known platform performance or evidence of profitable seconds trading. Set the
real budget from the strategy's delay curve, and treat clock/feed uncertainty separately.

## 20. Report template and decision rules

Create a report directory such as `artifacts/latency/<run-id>/` and exclude bulk raw
data from Git. Use an immutable run ID, not a directory that silently overwrites
the last result. Store sensitive artifacts separately with appropriate access.

Suggested output layout:

```text
manifest.json
audit.md
metrics.json
latency-summary.csv
resource-timeseries.csv
data-quality.json
trace-sample.ndjson
recording-index.json
delay-cost-results.csv
decision-report.md
plots/
```

The decision report must contain:

1. **Question and scope:** feed, symbols, intended reaction deadlines and excluded claims.
2. **Environment:** code/image versions, hardware, region, workload and clock quality.
3. **Data integrity:** counts, frame/batch sizes, gaps, drops, corrections and limitations.
4. **Latency decomposition:** actual observed percentiles with counts and denominators.
5. **Capacity:** sustained rate, burst rate, backlog and the first failure criterion.
6. **Resource behavior:** event-loop delay, per-process CPU, memory, GC, disk and credits.
7. **Order observations:** journal/HTTP/update/fill stages and unresolved orders, if tested.
8. **Strategy sensitivity:** fixed-rule results by delay, costs and session/date sample.
9. **Comparison:** changes, identical inputs, output-equivalence checks and repeatability.
10. **Recommendation:** useful next action, expected benefit, complexity and uncertainty.
11. **Reproduction:** exact implemented commands and immutable inputs/configuration.
12. **Limitations:** what the sample, clocks, feed and simulator cannot establish.

### Summary table to populate with actual data

| Metric | Count | p50 | p95 | p99 | Maximum | Unit | Caveat |
|---|---|---|---|---|---|---|---|
| Quote observed age | | | | | | ms | External clocks and upstream delay |
| Trade observed age | | | | | | ms | Event-time semantics and late prints |
| Parse/normalize | | | | | | ms | Frame versus event denominator |
| Strategy evaluation | | | | | | ms | Include no-signal evaluations |
| Required journal wait | | | | | | ms | Preserve durability |
| Application receive-to-submit | | | | | | ms | Only events producing an order |
| Submit-to-response | | | | | | ms | HTTP client boundary, not exchange arrival |
| Submit-to-first-fill update | | | | | | ms | Paper simulation; report unfilled count |
| Event-loop delay | | | | | | ms | Resolution and sampling configuration |

Blank cells here are a template, not missing results to estimate. Mark metrics
not measured or not applicable explicitly. Show both all-event and order-producing
event distributions where their populations differ.

### Decision matrix

| Observed condition | Recommended interpretation/action |
|---|---|
| Local processing small and stable; delay curve insensitive | Keep simple design; prioritize research, data correctness and reliability |
| Local tail grows with logs, scans, GC or background workers | Optimize/isolate the measured work and rerun fixed workloads |
| Journal dominates action budget | Review durable-path design/locality; retain fail-closed semantics |
| External age dominates with acceptable clock confidence | Investigate data/transport/host placement; local micro-optimizations have limited reach |
| Sparse or stale IEX observations dominate | Reconsider data coverage or strategy horizon; faster evaluation cannot recover unseen events |
| Net strategy result fails even at zero additional delay | Revisit the strategy/cost assumptions before tuning latency |
| Model-service delays dominate but add little net value | Simplify the model/integration or remove it |
| Expected gain smaller than uncertainty or run variability | Gather more comparable evidence; do not claim an optimization win |
| Paper results look strong but rely on optimistic fills | Improve execution assumptions and collect more evidence |

Do not call the platform HFT-ready based on one average latency, one successful
paper order or one profitable day. The useful conclusion is whether a particular
strategy, feed and deployment have adequate measured timing and credible economics.

## 21. Sources and final handoff

Provider and infrastructure facts were checked against the primary references below
when this reconstruction was written. Recheck entitlement, schema, runtime and
deployment details before executing a future benchmark. The experiment design,
threshold examples and implementation tickets are recommendations for this project.

- [Alpaca market-data FAQ][alpaca-faq]: feed scope and explicit feed selection.
- [Alpaca streaming protocol][alpaca-stream]: connections, subscriptions, batching and errors.
- [Alpaca real-time stock schema][alpaca-stock]: quotes, trades, bars and corrections.
- [Alpaca paper trading][alpaca-paper]: simulation and fill limitations.
- [Alpaca order workflow][alpaca-orders]: order lifecycle and client-order identifiers.
- [Node process timing][node-process]: monotonic high-resolution duration measurement.
- [Node performance hooks][node-perf]: event-loop and performance instrumentation.
- [AWS time synchronization][aws-time]: host clock configuration and capabilities.
- [AWS CPU-credit monitoring][aws-credits]: burstable-instance observations.

Before handing off, include the actual implementation diff, passing checks and
remaining limitations. State precisely which benchmark modes ran, on which host,
with which data and whether any broker paper orders were submitted. Link the
result artifacts and identify the next action supported by the evidence.

If market hours, credentials, target-host access or representative data are missing,
complete the independent fixture/replay/instrumentation work, record the exact
external prerequisite, and leave an executable operating procedure. Do not report
an unrun phase as complete. If optimization is unnecessary, say so and preserve
the baseline so later strategy teams can repeat the decision.

[alpaca-faq]: https://docs.alpaca.markets/us/docs/market-data-faq
[alpaca-stream]: https://docs.alpaca.markets/us/docs/streaming-market-data
[alpaca-stock]: https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data
[alpaca-paper]: https://docs.alpaca.markets/us/docs/paper-trading
[alpaca-orders]: https://docs.alpaca.markets/us/docs/working-with-orders
[node-process]: https://nodejs.org/docs/latest-v22.x/api/process.html#processhrtimebigint
[node-perf]: https://nodejs.org/api/perf_hooks.html
[aws-time]: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/set-time.html
[aws-credits]: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-monitoring-cpu-credits.html
