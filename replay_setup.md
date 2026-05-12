# Replay System — Build Guide

The `ReplayEngine` (`backend/src/core/replay/replayEngine.ts`) is fully implemented.
What remains is wiring it to the API, creating the Supabase table, and building the
event recorder so there is data to replay.

Complete the steps below in order.

---

## Part 1 — Prerequisites

Replay shares the same backend environment as backtest. If you have already completed
Part 1 of `backtest_setup.md` (npm install, `.env` file, Supabase keys), skip to Part 2.

Otherwise complete those steps first — replay requires the same Alpaca and Supabase
credentials.

---

## Part 2 — Create the Supabase `event_logs` Table

Open the Supabase dashboard → SQL Editor → New query. Paste and run:

```sql
create table if not exists event_logs (
  id           uuid         primary key,
  name         text         not null,
  description  text,
  source       text         not null,   -- 'live', 'backtest', 'synthetic'
  run_id       uuid,                    -- FK to strategy_runs if from a live session
  event_count  integer      not null,
  events       jsonb        not null,   -- TradingEvent[] array
  start_date   timestamptz  not null,
  end_date     timestamptz  not null,
  created_at   timestamptz  not null default now()
);
```

Verify the table appears under Table Editor before continuing.

---

## Part 3 — Add Repository Functions for `event_logs`

**File:** `backend/src/adapters/supabase/repositories.ts`

Add the following functions at the bottom of the file, following the same pattern as the existing backtest result functions:

```typescript
// ------------------------------------------------------------------
// Event Logs (Replay)
// ------------------------------------------------------------------

export async function insertEventLog(log: EventLogRecord & { events: TradingEvent[] }): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("event_logs").insert({
    id: log.id,
    name: log.name,
    description: log.description,
    source: log.source,
    run_id: log.runId,
    event_count: log.eventCount,
    events: log.events,
    start_date: log.startDate,
    end_date: log.endDate,
  });
  if (error) logger.error("insertEventLog failed", { error: error.message });
}

export async function getAllEventLogs(): Promise<EventLogRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("event_logs")
    .select("id, name, description, source, run_id, event_count, start_date, end_date, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    logger.error("getAllEventLogs failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    source: row.source,
    runId: row.run_id,
    eventCount: row.event_count,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: new Date(row.created_at).getTime(),
  })) as EventLogRecord[];
}

export async function getEventLogById(id: UUID): Promise<(EventLogRecord & { events: TradingEvent[] }) | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("event_logs")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    logger.error("getEventLogById failed", { error: error.message });
    return null;
  }
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    source: data.source,
    runId: data.run_id,
    eventCount: data.event_count,
    events: data.events as TradingEvent[],
    startDate: data.start_date,
    endDate: data.end_date,
    createdAt: new Date(data.created_at).getTime(),
  };
}
```

Add the required imports at the top of `repositories.ts`:

```typescript
import type { EventLogRecord } from "../../types/replay";
import type { TradingEvent } from "../../types/events";
```

---

## Part 4 — Inject `ReplayEngine` into the Express App

The `ReplayEngine` instance is created in `runtime/replay.ts` but never passed to
the controllers. The fix is to pass it through the Express app context.

### Step 1 — Update `createApp()` to accept a `ReplayEngine`

**File:** `backend/src/app/index.ts`

Change the `createApp` signature to accept an optional `ReplayEngine`:

```typescript
import { ReplayEngine } from "../core/replay/replayEngine";

export function createApp(replayEngine?: ReplayEngine): express.Application {
  const app = express();

  // Store on app.locals so controllers can access it
  if (replayEngine) {
    app.locals["replayEngine"] = replayEngine;
  }

  // ... rest of existing middleware setup unchanged ...
}
```

### Step 2 — Pass the engine from `runtime/replay.ts`

**File:** `backend/src/runtime/replay.ts`

Update the `createApp()` call to pass the engine:

```typescript
const app = createApp(replayEngine);
```

### Step 3 — Update `runtime/live.ts` (no-op pass)

**File:** `backend/src/runtime/live.ts`

The live runtime calls `createApp()` with no arguments — this is fine as-is since
`replayEngine` is optional. No change needed.

---

## Part 5 — Wire Up `replayController.ts`

**File:** `backend/src/app/controllers/replayController.ts`

Replace the entire file with the following implementation. Each function reads the
`ReplayEngine` from `req.app.locals` and calls the appropriate method.

```typescript
import type { Request, Response } from "express";
import { ReplayEngine } from "../../core/replay/replayEngine";
import {
  getAllEventLogs,
  getEventLogById,
} from "../../adapters/supabase/repositories";
import { logger } from "../../utils/logger";
import { newId } from "../../utils/ids";
import { nowMs } from "../../utils/time";
import type { ReplayCommand, ReplaySession } from "../../types/replay";

function getEngine(req: Request): ReplayEngine | null {
  return (req.app.locals["replayEngine"] as ReplayEngine) ?? null;
}

export async function listReplaySessions(req: Request, res: Response): Promise<void> {
  try {
    const logs = await getAllEventLogs();
    res.json(logs);
  } catch (err) {
    logger.error("listReplaySessions error", { err });
    res.status(500).json({ error: "Failed to fetch replay sessions" });
  }
}

export async function loadReplaySession(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.body as { sessionId: string };
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  const engine = getEngine(req);
  if (!engine) {
    res.status(503).json({ error: "ReplayEngine not available in this runtime mode" });
    return;
  }

  try {
    const log = await getEventLogById(sessionId);
    if (!log) {
      res.status(404).json({ error: `Event log ${sessionId} not found` });
      return;
    }

    const session: ReplaySession = {
      id: newId(),
      name: log.name,
      sourceRunId: log.runId,
      events: log.events,
      totalEvents: log.events.length,
      cursor: 0,
      status: "paused",
      speed: 1,
      replayStrategies: false,
      simulatedNow: log.events[0]?.ts ?? nowMs(),
      createdAt: nowMs(),
      description: log.description,
    };

    engine.load(session);
    logger.info("loadReplaySession: session loaded", { sessionId, totalEvents: session.totalEvents });
    res.json({ message: "Session loaded", session: engine.getSession() });
  } catch (err) {
    logger.error("loadReplaySession error", { sessionId, err });
    res.status(500).json({ error: "Failed to load replay session" });
  }
}

export async function controlReplay(req: Request, res: Response): Promise<void> {
  const command = req.body as ReplayCommand;
  if (!command?.action) {
    res.status(400).json({ error: "command.action is required" });
    return;
  }

  const engine = getEngine(req);
  if (!engine) {
    res.status(503).json({ error: "ReplayEngine not available in this runtime mode" });
    return;
  }

  engine.control(command);
  logger.info("controlReplay: command applied", { action: command.action });
  res.json({ message: "Command applied", session: engine.getSession() });
}

export async function getReplayStatus(req: Request, res: Response): Promise<void> {
  const engine = getEngine(req);
  if (!engine) {
    res.json(null);
    return;
  }
  res.json(engine.getSession());
}
```

---

## Part 6 — Build the Event Recorder

The replay engine plays back a `TradingEvent[]` stored in `event_logs`. Something must
write those events during a live session. The `EventBus` already has an `onAll(handler)`
method designed for exactly this purpose.

Create a new file `backend/src/core/replay/eventRecorder.ts`:

```typescript
/**
 * core/replay/eventRecorder.ts
 *
 * Records all TradingEvents published to an EventBus during a session.
 * Call start() to begin recording and stop() to get the captured events.
 * The captured log can then be persisted to the event_logs table for replay.
 */

import { EventBus } from "../engine/eventBus";
import type { TradingEvent } from "../../types/events";

export class EventRecorder {
  private events: TradingEvent[] = [];
  private recording = false;
  private readonly handler = (event: TradingEvent): void => {
    this.events.push(event);
  };

  constructor(private readonly eventBus: EventBus) {}

  start(): void {
    if (this.recording) return;
    this.events = [];
    this.recording = true;
    this.eventBus.onAll(this.handler);
  }

  stop(): TradingEvent[] {
    if (!this.recording) return this.events;
    this.recording = false;
    this.eventBus.offAll(this.handler);
    return this.events;
  }

  get isRecording(): boolean {
    return this.recording;
  }
}
```

### Wire the recorder into `runtime/live.ts`

**File:** `backend/src/runtime/live.ts`

Import and start the recorder, then persist the log on shutdown:

```typescript
import { EventRecorder } from "../core/replay/eventRecorder";
import { insertEventLog } from "../adapters/supabase/repositories";
import { newId } from "../utils/ids";
import { nowIso } from "../utils/time";

// After eventBus is created:
const recorder = new EventRecorder(eventBus);
recorder.start();

// In the shutdown function, before process.exit(0):
const events = recorder.stop();
if (events.length > 0) {
  await insertEventLog({
    id: newId(),
    name: `Live session ${new Date().toISOString()}`,
    source: "live",
    eventCount: events.length,
    events,
    startDate: nowIso(),
    endDate: nowIso(),
    createdAt: Date.now(),
  });
  logger.info("runtime/live: event log persisted", { eventCount: events.length });
}
```

---

## Part 7 — Smoke Test End-to-End

### 7a. Generate a replay session

Start the live paper trading runtime and let it run for at least a few minutes so
market data events are recorded:

```bash
npm run dev:live
```

Stop it with `Ctrl+C`. You should see:

```
runtime/live: event log persisted { eventCount: <N> }
```

Confirm in Supabase → Table Editor → `event_logs` that a row was inserted.

### 7b. Start the replay runtime

```bash
npm run dev:replay
```

You should see:

```
Replay API server listening on port 8080
```

### 7c. Test the API endpoints

List available sessions:

```bash
curl http://localhost:8080/api/replay/sessions
```

Expected: a JSON array containing the session recorded in step 7a.

Load a session (replace `<id>` with the `id` from the list):

```bash
curl -X POST http://localhost:8080/api/replay/load \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "<id>"}'
```

Expected: `{ "message": "Session loaded", "session": { "status": "paused", ... } }`

Start playback:

```bash
curl -X POST http://localhost:8080/api/replay/control \
  -H "Content-Type: application/json" \
  -d '{"action": "play"}'
```

Check status while playing:

```bash
curl http://localhost:8080/api/replay/status
```

Expected: `cursor` should be advancing; `status` should be `"playing"` and eventually `"completed"`.

---

## Part 8 — Deterministic Clock

**Status: DONE** — `backend/src/utils/time.ts`

By default every call to `nowMs()` returns `Date.now()`. During replay this is wrong:
strategy signals, portfolio snapshots, and orchestrator events would all carry wall-clock
timestamps instead of the simulated time of the event being replayed.

The fix is a module-level clock override that the `ReplayEngine` activates before each
event emission:

```typescript
// utils/time.ts (already implemented)
let _clockOverride: (() => EpochMs) | null = null;

export function setClockOverride(fn: (() => EpochMs) | null): void {
  _clockOverride = fn;
}

export function nowMs(): EpochMs {
  return _clockOverride ? _clockOverride() : Date.now();
}
```

`nowIso()` and `isStale()` now route through `nowMs()` as well, so the override
propagates everywhere without any changes to strategies, orchestrator, or portfolio state.

### Wiring the override into `ReplayEngine`

**File:** `backend/src/core/replay/replayEngine.ts`

Import `setClockOverride` and call it in `_emitNext()` and `stop()`:

```typescript
import { setClockOverride } from "../../utils/time";

// In _emitNext(), immediately before eventBus.publish(event):
this.session.simulatedNow = event.ts;
setClockOverride(() => this.session!.simulatedNow);
this.eventBus.publish(event);                // all nowMs() calls here return simulated time
this.session.cursor++;

if (this.session.cursor >= this.session.totalEvents) {
  this.session.status = "completed";
  setClockOverride(null);                    // restore wall clock
}

// In stop():
setClockOverride(null);
```

> **Why `ts` on `REPLAY_TICK` uses `Date.now()` directly (not `nowMs()`):**
> At the point the tick is published, `nowMs()` returns simulated time. The tick's
> envelope needs a real delivery timestamp so the WebSocket message is correctly
> time-ordered on the client. Use `Date.now()` explicitly for that one field only.

### Why no other files need changing

Every wall-clock reference in strategies, orchestrator, and portfolio state already
calls `nowMs()`. The override is the single injection point. This replaces the
process-global `Date.now = () => bar.ts` monkey-patch used by the backtest engine —
that patch can be migrated to `setClockOverride` in a separate cleanup.

---

## Part 9 — WebSocket Status Streaming

The replay runtime currently starts an Express server via `app.listen()`, which does not
support WebSocket upgrades. The frontend's `useReplay` hook polls for status updates
instead of receiving them in real time.

This part wires up the existing `attachWebSocketServer` infrastructure and adds a
`REPLAY_TICK` event so the frontend receives live progress without polling.

### 9a — `REPLAY_TICK` event type

**Status: DONE** — `backend/src/types/events.ts`

`REPLAY_TICK` is added to `EventType`, defined as `ReplayTickEvent`, and included in the
`TradingEvent` discriminated union. The `ReplayEngine` publishes one tick after every
event emission carrying `{ sessionId, cursor, totalEvents, status, speed, simulatedNow }`.

### 9b — Add `REPLAY_TICK` to the broadcast set

**File:** `backend/src/app/websocket.ts`

```typescript
const BROADCAST_EVENT_TYPES = new Set([
  // ... existing types ...
  "REPLAY_TICK",   // ← add this line
]);
```

### 9c — Attach WebSocket server in replay runtime

**File:** `backend/src/runtime/replay.ts`

Replace `app.listen()` with the same `http.createServer` pattern used in `runtime/live.ts`:

```typescript
import http from "http";
import { attachWebSocketServer } from "../app/websocket";

// Replace:
//   app.listen(env.port, () => { ... });
// With:
const server = http.createServer(app);
attachWebSocketServer(server, eventBus);
server.listen(env.port, () => {
  logger.info(`Replay server listening on port ${env.port}`);
});

// In the shutdown handler, replace process.exit(0) with:
server.close(() => process.exit(0));
```

### 9d — Publish `REPLAY_TICK` from `ReplayEngine`

**File:** `backend/src/core/replay/replayEngine.ts`

After advancing the cursor in `_emitNext()`, publish a tick. Note the `ts` field uses
`Date.now()` directly — see Part 8 for why:

```typescript
import { newId } from "../../utils/ids";

// After this.session.cursor++ in _emitNext():
this.eventBus.publish({
  id: newId(),
  type: "REPLAY_TICK",
  ts: Date.now(),            // wall-clock delivery time, not simulated
  mode: "replay",
  sessionId: this.session.id,
  cursor: this.session.cursor,
  totalEvents: this.session.totalEvents,
  status: this.session.status,
  speed: this.session.speed,
  simulatedNow: this.session.simulatedNow,
});
```

### 9e — Update `useReplay` to consume `REPLAY_TICK` over WebSocket

**File:** `frontend/hooks/useReplay.ts`

Follow the same pattern used in `usePortfolio.ts` and `SystemHealthCard.tsx` — subscribe
to the shared `/ws/events` stream and filter for `REPLAY_TICK`:

```typescript
import { useWebSocket } from "./useWebSocket";
import type { TradingEvent } from "../types/api";

// Inside useReplay():
const { lastMessage } = useWebSocket<TradingEvent>("/ws/events");

useEffect(() => {
  if (!lastMessage || lastMessage.type !== "REPLAY_TICK") return;
  const tick = lastMessage as ReplayTickEvent;
  setSession((prev) =>
    prev && prev.id === tick.sessionId
      ? { ...prev, cursor: tick.cursor, status: tick.status, speed: tick.speed, simulatedNow: tick.simulatedNow }
      : prev
  );
}, [lastMessage]);
```

Remove the `fetchReplayStatus()` call inside `control()` — the WS tick now delivers the
updated state automatically after each command takes effect.

---

## Part 10 — Event Filtering

**Status: SCAFFOLDED** — `backend/src/core/replay/replayFilter.ts`, `backend/src/types/replay.ts`

The `ReplayFilter` type and `applyFilter()` stub are in place. See the plan file for the
full implementation spec.

Filter fields (all optional, ANDed):
- `eventTypes?: EventType[]` — only include these event types
- `symbols?: string[]` — only include events whose `payload.symbol` is in this set;
  events with no symbol field (system/portfolio events) always pass through
- `startTs?: EpochMs` — lower bound on `event.ts`
- `endTs?: EpochMs` — upper bound on `event.ts`

Applied in `replayController.loadReplaySession()` after fetching events from DB:

```typescript
const filteredEvents = filter ? applyFilter(log.events, filter) : log.events;
```

Request body expands to `{ sessionId: string; filter?: ReplayFilter }`.

**Frontend:** Add a `ReplayFilterPanel` component (new file) with checkboxes for event
types (grouped by category), a symbol input, and a time window range picker. The Apply
button is disabled until at least one filter field is non-empty. When a symbol or time
filter is active, all strategies that touch those events appear in the filtered stream —
the filter does not collapse to a single strategy view.

Also wire `seek_ts` command (defined in `ReplayCommand`): binary-search `session.events`
for the first event with `ts >= targetTs`, set cursor to that index. Add a
`datetime-local` input to `ReplayControls` that sends this command on change.

---

## Part 11 — Performance Attribution

**Status: SCAFFOLDED** — `backend/src/core/replay/attributionCollector.ts`, `backend/src/types/replay.ts`

The `AttributionCollector` class and all attribution types (`SignalAttribution`,
`ReplayAttribution`, `StrategyAttributionSummary`) are scaffolded. See the plan file for
the full implementation spec.

Only meaningful when `replayStrategies: true` so the execution sink produces real fills.

New endpoint: `GET /api/replay/attribution` → `getReplayAttribution()` controller handler.

**Frontend:** Add a `ReplayAttribution` component (new file) rendered below `ReplayPlayer`
when `session.status === "completed"`. Sections:

1. **Summary bar** — fill rate, win rate, total realized P&L, avg slippage (bps),
   avg holding time, max drawdown
2. **Strategy breakdown** — one row per strategy ID (populated when multiple strategies ran)
3. **Signal table** — sortable: symbol, direction, signal time, mid price, fill price,
   slippage, holding time, P&L, outcome badge
4. **Equity curve** — SVG/chart: X = simulated time, Y = equity; one line per strategy

Auto-fetch attribution when `session.status` flips to `"completed"` inside the
`REPLAY_TICK` effect in `useReplay`.

---

## Checklist

**Parts 1–7 (core wiring)**
- [ ] `event_logs` table created in Supabase
- [ ] Repository functions (`insertEventLog`, `getAllEventLogs`, `getEventLogById`) added
- [ ] `createApp()` accepts and stores `ReplayEngine` on `app.locals`
- [ ] `runtime/replay.ts` passes `replayEngine` to `createApp()`
- [ ] `replayController.ts` fully implemented (no 501s)
- [ ] `EventRecorder` class created
- [ ] `runtime/live.ts` starts recorder on boot and persists log on shutdown
- [ ] `GET /api/replay/sessions` returns a non-empty array after a live session
- [ ] `POST /api/replay/load` loads a session without error
- [ ] `POST /api/replay/control` with `{"action": "play"}` starts playback
- [ ] `GET /api/replay/status` shows `cursor` advancing during playback

**Part 8 (deterministic clock)**
- [x] `setClockOverride` added to `utils/time.ts`
- [x] `nowIso()` and `isStale()` route through `nowMs()`
- [ ] `ReplayEngine._emitNext()` calls `setClockOverride` before `eventBus.publish`
- [ ] `ReplayEngine.stop()` calls `setClockOverride(null)`

**Part 9 (WebSocket streaming)**
- [x] `REPLAY_TICK` added to `EventType`, `ReplayTickEvent` defined, added to `TradingEvent` union
- [ ] `"REPLAY_TICK"` added to `BROADCAST_EVENT_TYPES` in `websocket.ts`
- [ ] `runtime/replay.ts` uses `http.createServer` + `attachWebSocketServer`
- [ ] `ReplayEngine._emitNext()` publishes `REPLAY_TICK` after each event
- [ ] `useReplay` subscribes to `/ws/events` and patches session on `REPLAY_TICK`
- [ ] `control()` in `useReplay` no longer calls `fetchReplayStatus()` after each command

**Part 10 (event filtering)**
- [x] `ReplayFilter` type defined in `replay.ts`
- [x] `seek_ts` command added to `ReplayCommand`
- [x] `applyFilter()` scaffolded in `replayFilter.ts`
- [ ] `applyFilter()` fully implemented
- [ ] `replayController.loadReplaySession` accepts and applies `filter`
- [ ] `ReplayFilterPanel` component built and integrated into `ReplayPlayer`
- [ ] `ReplayControls` timestamp seek input added
- [ ] `useReplay.loadSession` accepts optional `ReplayFilter`

**Part 11 (performance attribution)**
- [x] `SignalAttribution`, `ReplayAttribution`, `StrategyAttributionSummary` types defined
- [x] `AttributionCollector` scaffolded
- [ ] `AttributionCollector` fully implemented
- [ ] `GET /api/replay/attribution` route and controller added
- [ ] `ReplayEngine` wires attribution collector when `replayStrategies: true`
- [ ] `ReplayAttribution` frontend component built
- [ ] `useReplay` exposes `attribution` and auto-fetches on session complete
