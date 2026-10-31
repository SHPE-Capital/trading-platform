# Replay workflows

There are two different replay paths. Choose by purpose; they are not
interchangeable features of the Replay page.

| Purpose | Current path | Availability |
|---|---|---|
| Measure processing or delay on recorded market frames | Benchmark capture/replay commands | Implemented, separate CLI/artifact format |
| Browse recorded trading sessions and control them in the Replay page | `REPLAY_RECORD`, `ReplayEngine` and `/api/replay/*` | Implemented: record, list, load (filtered), play, seek, attribution |

## Testing strategies outside market hours

The paper runner always trades live data; it no longer replays cached bars. A
cached-bar replay inside the runner could not use a simulated clock (trading
processes lock the real clock), so strategies saw re-stamped timestamps and
compressed time and behaved differently than in a backtest. Outside market
hours, use [backtesting](backtesting.md): the same strategy code, historical
bars, and a simulated clock.

## Benchmark recordings

Use [the latency runbook](latency-benchmark.md) for `bench:capture`,
`bench:replay`, fixture recordings and `bench:delay`. These recordings contain
market-frame/timing evidence for an isolated benchmark process. They are not
`event_logs` sessions and cannot be loaded through `/api/replay/load`.

## Recorded-session replay

### 1. Record a session

Start a trading runtime with recording on. Stop it gracefully (Ctrl+C or
SIGTERM) so it can save:

```bash
cd backend
REPLAY_RECORD=1 npm run dev:paper-trading
```

| Variable | Default | Meaning |
|---|---|---|
| `REPLAY_RECORD` | `false` | Record every event on the runtime's bus |
| `REPLAY_RECORD_MAX_EVENTS` | `200000` | Events kept in memory; beyond this the oldest are dropped |

On shutdown the runtime writes one `event_logs` row (`source` = `paper` or
`live`). The log says `bootstrap: event log persisted` with the row's ID. If the
cap was reached, the row's description gives how many early events were dropped.
A failed save is logged and does not block shutdown. A crash or `kill -9` saves
nothing.

Quotes make up most of the volume. At the default cap a busy symbol set covers
minutes, not a session. Raise the cap only on hosts that have the memory for it:
the buffer and the jsonb row grow together.

### 2. Play it back

```bash
cd backend
npm run dev:replay        # REST + WebSocket on PORT (default 8080)
```

The replay runtime serves the same port as the paper runner by default. Stop the
runner first, or give one of them another `PORT`. Then open the Replay page in
the frontend.

| Endpoint | Behavior |
|---|---|
| `GET /api/replay/sessions` | Recorded logs, newest first (metadata only) |
| `POST /api/replay/load` | `{ sessionId, filter? }`. Loads the log paused at its first event. `400` bad ID or empty filter, `404` unknown log, `422` filter matches nothing |
| `POST /api/replay/control` | `play`, `pause`, `step`, `seek {targetIndex}`, `seek_ts {targetTs}`, `set_speed {speed}`, `reset`. Returns the session state |
| `GET /api/replay/status` | The loaded session without its events, or `null` |
| `GET /api/replay/attribution` | The report once playback has completed; `409` before then |

Progress arrives as `REPLAY_TICK` on `/ws/events`: after every command, on
completion, and at most every 100 ms while playing. The replayed order, fill,
signal and portfolio events are broadcast on the same socket. When the socket is
not open, the page polls `/status` while a session plays.

### Filters

A filter ANDs every field it sets:

- `eventTypes`: only these types.
- `symbols`: only events about these symbols. Events with no symbol (portfolio,
  system) always pass, so the equity curve and lifecycle events stay in.
- `startTs` / `endTs`: inclusive bounds on the event `ts` (Unix ms).

### Time during playback

While each event is published, `nowMs()` returns that event's recorded `ts`. Code
reacting to it sees the recorded time, not the wall clock. The override covers
only the synchronous publish. The engine never installs it in a process whose
clock a trading engine has locked.

### Attribution

When playback completes, the report correlates `STRATEGY_SIGNAL_CREATED` with
orders, fills and rejections by signal ID. It reports fill rate, win rate,
slippage against the mid at signal time, holding time, realized P&L and max
drawdown from `PORTFOLIO_UPDATED`. Lots are matched FIFO per strategy and symbol.
A closed lot's P&L and holding time belong to the signal that opened it. P&L is
gross of commission.

## Limits

- Strategies are not re-run. `replayStrategies` stays `false`, and the report
  describes what was recorded, not what the current code would do.
- Seeking moves the cursor; it does not rebuild portfolio or strategy state.
  Reset and seeks restart attribution from the new position, so the report
  covers only what was played since. A filter that drops a round trip's fills
  leaves that P&L out too.
- `/api/replay/*` has no auth middleware, like the rest of the replay runtime.
  Do not expose that process publicly.
- One loaded session per replay process.

The earlier implementation proposal is retained in
[history](../history/implementation-plans/guides-replay.md).
