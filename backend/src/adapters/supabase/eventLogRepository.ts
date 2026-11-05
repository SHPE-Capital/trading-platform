/**
 * adapters/supabase/eventLogRepository.ts
 *
 * Recorded TradingEvent streams (table event_logs, from 0000) that the replay
 * runtime loads and plays back. Listing reads metadata only — the events
 * column holds the whole stream and is fetched only when a log is loaded.
 */

import { getSupabaseClient } from "./client";
import type { EventLogsRow } from "../../db/schema/tables";
import type { EventLogRecord } from "../../types/replay";
import type { TradingEvent } from "../../types/events";
import type { UUID } from "../../types/common";

const META_COLUMNS = "id, name, description, source, run_id, event_count, start_date, end_date, created_at";

type EventLogMetaRow = Omit<EventLogsRow, "events">;

function mapEventLog(row: EventLogMetaRow): EventLogRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    source: row.source,
    runId: row.run_id ?? undefined,
    eventCount: row.event_count,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/** Persists a recorded event stream. createdAt is set by the database. */
export async function insertEventLog(
  record: Omit<EventLogRecord, "createdAt">,
  events: TradingEvent[],
): Promise<void> {
  const { error } = await getSupabaseClient().from("event_logs").insert({
    id: record.id,
    name: record.name,
    description: record.description ?? null,
    source: record.source,
    run_id: record.runId ?? null,
    event_count: record.eventCount,
    events,
    start_date: record.startDate,
    end_date: record.endDate,
  });
  if (error) throw new Error(`insertEventLog failed: ${error.message}`);
}

/** Metadata for every stored log, newest first. */
export async function listEventLogs(): Promise<EventLogRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from("event_logs")
    .select(META_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listEventLogs failed: ${error.message}`);
  return ((data ?? []) as EventLogMetaRow[]).map(mapEventLog);
}

/** One log with its events, or null when no log has that ID. */
export async function getEventLog(
  id: UUID,
): Promise<{ record: EventLogRecord; events: TradingEvent[] } | null> {
  const { data, error } = await getSupabaseClient()
    .from("event_logs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getEventLog failed: ${error.message}`);
  if (!data) return null;
  const row = data as EventLogsRow;
  return { record: mapEventLog(row), events: (row.events ?? []) as TradingEvent[] };
}
