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
Replay API server listening on port 3001
```

### 7c. Test the API endpoints

List available sessions:

```bash
curl http://localhost:3001/api/replay/sessions
```

Expected: a JSON array containing the session recorded in step 7a.

Load a session (replace `<id>` with the `id` from the list):

```bash
curl -X POST http://localhost:3001/api/replay/load \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "<id>"}'
```

Expected: `{ "message": "Session loaded", "session": { "status": "paused", ... } }`

Start playback:

```bash
curl -X POST http://localhost:3001/api/replay/control \
  -H "Content-Type: application/json" \
  -d '{"action": "play"}'
```

Check status while playing:

```bash
curl http://localhost:3001/api/replay/status
```

Expected: `cursor` should be advancing; `status` should be `"playing"` and eventually `"completed"`.

---

## Checklist

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
