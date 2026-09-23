/**
 * features/approvals/ConfigDiffView.tsx
 *
 * Field-by-field diff between two versions of a strategy's config — the
 * review page's equivalent of a PR's "Files changed" tab.
 */

"use client";

import { diffConfigs, formatConfigValue, type DiffKind } from "../../utils/configDiff";

interface Props {
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  beforeLabel: string;
  afterLabel: string;
}

const ROW_STYLES: Record<DiffKind, string> = {
  changed: "",
  added: "bg-green-50 dark:bg-green-950/40",
  removed: "bg-red-50 dark:bg-red-950/40",
};

export default function ConfigDiffView({ before, after, beforeLabel, afterLabel }: Readonly<Props>) {
  if (!before) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        This is the strategy&apos;s first version — there is nothing earlier to compare against.
      </p>
    );
  }

  const { rows, unchangedCount } = diffConfigs(before, after);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No config differences between {beforeLabel} and {afterLabel}.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">{beforeLabel}</th>
            <th className="px-3 py-2 font-medium">{afterLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.path}
              data-kind={row.kind}
              className={`border-b border-zinc-100 last:border-0 dark:border-zinc-800 ${ROW_STYLES[row.kind]}`}
            >
              <td className="px-3 py-2 font-mono text-zinc-700 dark:text-zinc-300">{row.path}</td>
              <td className="px-3 py-2 font-mono text-red-700 dark:text-red-400">
                {row.kind === "added" ? "—" : formatConfigValue(row.path, row.before)}
              </td>
              <td className="px-3 py-2 font-mono text-green-700 dark:text-green-400">
                {row.kind === "removed" ? "—" : formatConfigValue(row.path, row.after)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-zinc-100 px-3 py-2 text-[11px] text-zinc-400 dark:border-zinc-800">
        {rows.length} field{rows.length === 1 ? "" : "s"} changed · {unchangedCount} unchanged
      </p>
    </div>
  );
}
