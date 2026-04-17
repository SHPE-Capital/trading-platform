/**
 * app/replay/page.tsx
 *
 * Replay page.
 * Lets users select a historical session and step through events with playback
 * controls, observing how the engine would have reacted tick-by-tick.
 *
 * Data:    useReplay hook for session state and control actions.
 * Layout:  Full-width ReplayPlayer feature component.
 */

"use client";

import ReplayPlayer from "../../features/replay/ReplayPlayer";
import { useReplay } from "../../hooks/useReplay";

export default function ReplayPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Replay</h1>
      <ReplayPlayer />
    </div>
  );
}
