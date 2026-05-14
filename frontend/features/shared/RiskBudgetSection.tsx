"use client";

export interface RiskBudgetState {
  maxCapitalPct: number;
  maxOpenOrders: number | null;
  maxOrderNotionalPct: number | null;
}

export const defaultRiskBudgetState: RiskBudgetState = {
  maxCapitalPct: 20,
  maxOpenOrders: null,
  maxOrderNotionalPct: null,
};

interface Props {
  value: RiskBudgetState;
  onChange: (next: RiskBudgetState) => void;
  orderSizeConflict?: string;
}

export default function RiskBudgetSection({ value, onChange, orderSizeConflict }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-500">Max Portfolio Allocation (%)</label>
        <input
          type="number"
          min="1"
          max="100"
          step="1"
          value={value.maxCapitalPct}
          onChange={(e) => onChange({ ...value, maxCapitalPct: Number(e.target.value) })}
          className={inputClass}
        />
        <p className="text-xs text-zinc-400">
          Maximum % of portfolio equity this strategy may hold at once.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-xs font-medium text-zinc-500 cursor-pointer">
          <input
            type="checkbox"
            checked={value.maxOpenOrders !== null}
            onChange={(e) =>
              onChange({ ...value, maxOpenOrders: e.target.checked ? 5 : null })
            }
            className="rounded border-zinc-300 dark:border-zinc-600"
          />
          Limit concurrent open orders
        </label>
        {value.maxOpenOrders !== null && (
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            value={value.maxOpenOrders}
            onChange={(e) => onChange({ ...value, maxOpenOrders: Number(e.target.value) })}
            className={inputClass}
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-xs font-medium text-zinc-500 cursor-pointer">
          <input
            type="checkbox"
            checked={value.maxOrderNotionalPct !== null}
            onChange={(e) =>
              onChange({ ...value, maxOrderNotionalPct: e.target.checked ? 10 : null })
            }
            className="rounded border-zinc-300 dark:border-zinc-600"
          />
          Limit single-order size (% of equity)
        </label>
        {value.maxOrderNotionalPct !== null && (
          <input
            type="number"
            min="0.1"
            max="100"
            step="0.1"
            value={value.maxOrderNotionalPct}
            onChange={(e) => onChange({ ...value, maxOrderNotionalPct: Number(e.target.value) })}
            className={inputClass}
          />
        )}
        {orderSizeConflict && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{orderSizeConflict}</p>
        )}
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
