/**
 * features/replay/ReplayPlayer.tsx
 *
 * Replay session player. Allows selecting a session, loading it into the
 * engine, and controlling playback via the ReplayControls component.
 *
 * Inputs:  useReplay hook data (session, sessions, control).
 * Outputs: Session selector, session info, and playback controls.
 */

"use client";

import ReplayControls from "../../components/controls/ReplayControls";
import { useReplay } from "../../hooks/useReplay";
import { formatTimestamp } from "../../utils/dates";

export default function ReplayPlayer() {
  const { session, sessions, isLoading, error, loadSession, control } = useReplay();

  if (isLoading) return <p className="text-sm text-zinc-400">Loading replay sessions…</p>;
  if (error) return <p className="text-sm text-red-500">{error}</p>;

  return (
    <div className="flex flex-col gap-6">
      {/* Session selector */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-zinc-500">Select Session</label>
        <select
          onChange={(e) => e.target.value && loadSession(e.target.value)}
          defaultValue=""
          className="w-full max-w-sm rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="" disabled>Choose a recorded session…</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {sessions.length === 0 && (
          <p className="text-xs text-zinc-400">No recorded sessions available. Run a live session first to record events.</p>
        )}
      </div>

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
    </div>
  );
}
