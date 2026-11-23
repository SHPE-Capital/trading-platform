/**
 * components/controls/ReplayControls.tsx
 *
 * Playback controls for the replay engine.
 * Renders play/pause/step/speed controls, a position scrubber (seek by index)
 * and a jump-to-time input (seek by timestamp) that send commands to the backend.
 *
 * Inputs:  ReplaySession state, onControl callback for sending commands.
 * Outputs: Rendered playback control bar.
 */

"use client";

import { useState } from "react";
import type { ReplaySession, ReplaySpeed } from "../../types/api";

interface Props {
  session: ReplaySession | null;
  onControl: (action: string, extra?: Record<string, unknown>) => Promise<void>;
}

const SPEEDS: ReplaySpeed[] = [0.5, 1, 2, 5, 10];

/** Unix ms → the local "YYYY-MM-DDTHH:mm:ss" a datetime-local input expects. */
function toLocalInput(ts: number): string {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 19);
}

export default function ReplayControls({ session, onControl }: Props) {
  // Scrubber position while dragging; null follows the session cursor.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [jumpTo, setJumpTo] = useState("");

  if (!session) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        No active replay session
      </div>
    );
  }

  const isPlaying = session.status === "playing";

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Play / Pause */}
      <button
        onClick={() => onControl(isPlaying ? "pause" : "play")}
        className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {isPlaying ? "Pause" : "Play"}
      </button>

      {/* Step */}
      <button
        onClick={() => onControl("step")}
        disabled={isPlaying}
        className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400"
      >
        Step
      </button>

      {/* Reset */}
      <button
        onClick={() => onControl("reset")}
        className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400"
      >
        Reset
      </button>

      {/* Speed selector */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-zinc-400">Speed:</span>
        {SPEEDS.map((speed) => (
          <button
            key={speed}
            onClick={() => onControl("set_speed", { speed })}
            className={[
              "rounded px-2 py-1 text-xs font-medium transition-colors",
              session.speed === speed
                ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
            ].join(" ")}
          >
            {speed}×
          </button>
        ))}
      </div>

      {/* Progress */}
      <span className="text-xs text-zinc-400">
        {session.cursor} / {session.totalEvents} events
      </span>

      {/* Scrubber: seek by event index on release */}
      <input
        type="range"
        aria-label="Replay position"
        min={0}
        max={Math.max(0, session.totalEvents - 1)}
        value={dragIndex ?? Math.min(session.cursor, Math.max(0, session.totalEvents - 1))}
        onChange={(e) => setDragIndex(Number(e.target.value))}
        onPointerUp={() => {
          if (dragIndex === null) return;
          onControl("seek", { targetIndex: dragIndex }).finally(() => setDragIndex(null));
        }}
        onKeyUp={() => {
          if (dragIndex === null) return;
          onControl("seek", { targetIndex: dragIndex }).finally(() => setDragIndex(null));
        }}
        className="w-full accent-zinc-900 dark:accent-zinc-50"
      />

      {/* Jump to time: seek to the first event at or after it */}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const targetTs = new Date(jumpTo).getTime();
          if (Number.isFinite(targetTs)) onControl("seek_ts", { targetTs });
        }}
      >
        <label htmlFor="replay-jump" className="text-xs text-zinc-400">Jump to:</label>
        <input
          id="replay-jump"
          type="datetime-local"
          step={1}
          value={jumpTo || toLocalInput(session.simulatedNow)}
          onChange={(e) => setJumpTo(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <button
          type="submit"
          disabled={!jumpTo}
          className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400"
        >
          Go
        </button>
      </form>
    </div>
  );
}
