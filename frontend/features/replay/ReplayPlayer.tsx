/**
 * features/replay/ReplayPlayer.tsx
 *
 * Replay session player. Allows selecting a recorded session, loading it
 * (whole or filtered) into the engine, controlling playback via the
 * ReplayControls component, and reading the attribution once it completes.
 *
 * Inputs:  useReplay hook data (session, sessions, attribution, control).
 * Outputs: Session selector, filter panel, session info, playback controls, attribution.
 */

"use client";

import { useState } from "react";
import ReplayControls from "../../components/controls/ReplayControls";
import ReplayFilterPanel from "./ReplayFilterPanel";
import ReplayAttribution from "./ReplayAttribution";
import { useReplay } from "../../hooks/useReplay";
import { formatTimestamp } from "../../utils/dates";
import type { EventLogRecord } from "../../types/api";

function optionLabel(log: EventLogRecord): string {
  return `${log.name} · ${log.source} · ${log.eventCount.toLocaleString()} events`;
}

export default function ReplayPlayer() {
  const { session, sessions, attribution, isLoading, error, loadSession, control } = useReplay();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (isLoading) return <p className="text-sm text-zinc-400">Loading replay sessions…</p>;

  const selected = sessions.find((s) => s.id === selectedId);

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Session selector */}
      <div className="flex flex-col gap-2">
        <label htmlFor="replay-session" className="text-xs font-medium text-zinc-500">Select Session</label>
        <select
          id="replay-session"
          onChange={(e) => {
            if (!e.target.value) return;
            setSelectedId(e.target.value);
            loadSession(e.target.value);
          }}
          defaultValue=""
          className="w-full max-w-xl rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="" disabled>Choose a recorded session…</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>{optionLabel(s)}</option>
          ))}
        </select>
        {sessions.length === 0 && (
          <p className="text-xs text-zinc-400">
            No recorded sessions available. Start a trading runtime with REPLAY_RECORD=1 and stop it gracefully to record one.
          </p>
        )}
        {selected?.description && <p className="text-xs text-zinc-400">{selected.description}</p>}
      </div>

      <ReplayFilterPanel
        sessionId={selectedId}
        onApply={(filter) => (selectedId ? loadSession(selectedId, filter) : Promise.resolve())}
      />

      {/* Current session info */}
      {session && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{session.name}</p>
          <div className="mb-4 flex flex-wrap gap-4 text-xs text-zinc-500">
            <span>Status: <strong className="text-zinc-700 dark:text-zinc-300 capitalize">{session.status}</strong></span>
            <span>Events: <strong className="text-zinc-700 dark:text-zinc-300">{session.totalEvents}</strong></span>
            <span>Simulated time: <strong className="text-zinc-700 dark:text-zinc-300">{formatTimestamp(session.simulatedNow)}</strong></span>
          </div>
          <ReplayControls session={session} onControl={control} />
        </div>
      )}

      {session?.status === "completed" && attribution && <ReplayAttribution attribution={attribution} />}
    </div>
  );
}
