# Replay workflows

There are two different replay paths. Choose by purpose; they are not
interchangeable features of the Replay page.

| Purpose | Current path | Availability |
|---|---|---|
| Measure processing or delay on recorded market frames | Benchmark capture/replay commands | Implemented, separate CLI/artifact format |
| Browse recorded trading sessions and control them in the Replay page | `ReplayEngine` and `/api/replay/*` | Playback core exists; persisted session integration is incomplete |

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

## Recorded-event playback: current boundary

`backend/src/core/replay/replayEngine.ts` can load an in-memory `ReplaySession`,
publish its events to its bus, and play, pause, step, seek by index, change speed,
or reset. The standalone `runtime/replay.ts` creates that engine and an Express
server. It does not compose the trading orchestrator/execution stack.

The current HTTP implementation is:

| Endpoint | Behavior |
|---|---|
| `GET /api/replay/sessions` | Returns `[]`; stored-session listing is a stub |
| `POST /api/replay/load` | Validates `sessionId`; returns `503` without an engine, otherwise `501` for the missing event-log repository integration |
| `POST /api/replay/control` | Applies an action to the engine if present; no loaded session means there is nothing to play |
| `GET /api/replay/status` | Returns the current session, or `null` |

`npm run dev:replay` from `backend/` starts the standalone server using `PORT`
(default 8080). Stop a conflicting paper runner or select another port. Starting
this server does not populate sessions; the frontend cannot complete a recorded
session load yet.

## Incomplete extensions

- `seek_ts` exists in the command type but has no engine switch implementation.
- `replayFilter.ts` returns its input; filters are not active.
- `AttributionCollector` is scaffolded and its report method throws.
- `replayStrategies` is session metadata; the standalone replay runtime does not
  construct a strategy/execution pipeline from it.
- `simulatedNow` is updated on playback, but this engine does not install the
  shared simulated-clock override.
- The runtime uses `app.listen()` without the trading WebSocket attachment;
  playback does not publish the proposed `REPLAY_TICK` stream. `useReplay` fetches
  status on refresh/control, rather than receiving continuous progress events.
- Seeking changes the cursor; it does not reconstruct strategy/portfolio state.

Do not use this partial path as a substitute for the backtest engine's clock or
accounting guarantees. The earlier implementation proposal is retained in
[history](../history/implementation-plans/guides-replay.md).
