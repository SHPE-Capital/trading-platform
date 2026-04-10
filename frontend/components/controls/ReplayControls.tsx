/**
 * components/controls/ReplayControls.tsx
 *
 * Playback controls for the replay engine.
 * Renders play/pause/step/speed controls that send commands to the backend.
 *
 * Inputs:  ReplaySession state, onControl callback for sending commands.
 * Outputs: Rendered playback control bar.
 */

"use client";

import type { ReplaySession, ReplaySpeed } from "../../types/api";

interface Props {
  session: ReplaySession | null;
  onControl: (action: string, extra?: Record<string, unknown>) => Promise<void>;
}

const SPEEDS: ReplaySpeed[] = [0.5, 1, 2, 5, 10];

export default function ReplayControls({ session, onControl }: Props) {
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
    </div>
  );
}
