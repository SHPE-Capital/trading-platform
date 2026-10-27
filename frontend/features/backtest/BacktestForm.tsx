/**
 * features/backtest/BacktestForm.tsx
 *
 * Form for configuring and launching a backtest run.
 * Shows the full strategy config (same fields as StrategyForm) plus the
 * backtest-specific extras: date range, initial capital, how fills are priced,
 * and spread buffer.
 * Picking a saved config populates all strategy fields; they remain
 * editable before submitting.
 *
 * Inputs:  onSubmit callback to trigger the backtest.
 * Outputs: Controlled form; calls onSubmit with BacktestConfig on submission.
 */

"use client";

/* Form fields intentionally snapshot the selected persisted configuration. */
 

import { useState, useEffect, useMemo } from "react";
import type { BacktestConfig } from "../../types/api";
import { useStrategyTypes } from "../../hooks/useStrategyTypes";
import type { StrategyType, ParamSpec } from "../../types/strategy";
import { useStrategyConfigs } from "../../hooks/useStrategyConfigs";
import { useStrategyVersions } from "../../hooks/useStrategyVersions";
import { daysAgoString } from "../../utils/dates";
import RiskBudgetSection, { type RiskBudgetState, defaultRiskBudgetState } from "../shared/RiskBudgetSection";

interface Props {
  onSubmit: (config: Omit<BacktestConfig, "id">) => Promise<void>;
  isLoading?: boolean;
}

export default function BacktestForm({ onSubmit, isLoading }: Props) {
  const { types, isLoading: typesLoading } = useStrategyTypes();
  const options = types.filter((t) => t.actions?.backtest.allowed === true &&
    (t.type === "pairs_trading" || (t.params?.length ?? 0) > 0));
  const [selectedType, setSelectedType] = useState<StrategyType>("pairs_trading");
  const activeType = options.find((t) => t.type === selectedType)?.type ?? options[0]?.type;
  return <div className="flex flex-col gap-4">
    <Field label="Strategy Type">
      <select aria-label="Strategy Type" className={inputClass} value={activeType ?? ""} onChange={(e) => setSelectedType(e.target.value as StrategyType)} disabled={typesLoading}>
        {options.map((t) => <option key={t.type} value={t.type}>{t.label}{t.status === "experimental" ? " (experimental)" : t.status === "retired" ? " (retired)" : ""}</option>)}
      </select>
    </Field>
    {activeType ? <StrategyBacktestForm key={activeType} type={activeType} onSubmit={onSubmit} isLoading={isLoading} /> :
      <p className="text-sm text-zinc-500">{typesLoading ? "Loading strategy types?" : "No backtestable strategies available."}</p>}
  </div>;
}

function StrategyBacktestForm({ type, onSubmit, isLoading }: Props & { type: StrategyType }) {
  const { strategies, definition, isLoading: configsLoading, save } = useStrategyConfigs(type);
  const [genericConfig, setGenericConfig] = useState<Record<string, unknown>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [selectedId, setSelectedId] = useState<string>("new");

  // Attribute a result to an immutable version only when its effective config matches.
  const { versions: selectedVersions } = useStrategyVersions(selectedId !== "new" ? selectedId : null);
  const latestVersionId = selectedVersions[0]?.id;

  // Strategy config fields (mirrors StrategyForm)
  const [leg1, setLeg1] = useState("SPY");
  const [leg2, setLeg2] = useState("QQQ");
  const [entryZScore, setEntryZScore] = useState(2.0);
  const [exitZScore, setExitZScore] = useState(0.5);
  const [rollingWindowMins, setRollingWindowMins] = useState(60);
  const [tradeNotionalUsd, setTradeNotionalUsd] = useState(5_000);
  const [maxHoldingMins, setMaxHoldingMins] = useState(1_440);
  const [cooldownMins, setCooldownMins] = useState(1);
  const [hedgeRatioMethod, setHedgeRatioMethod] = useState<"fixed" | "rolling_ols">("fixed");
  const [olsWindowMins, setOlsWindowMins] = useState(240);
  const [olsRecalcIntervalBars, setOlsRecalcIntervalBars] = useState(5);

  // Backtest-specific extras
  const [startDate, setStartDate] = useState(daysAgoString(365));
  const [endDate, setEndDate] = useState(daysAgoString(1));
  const [initialCapital, setInitialCapital] = useState(100_000);
  const [spreadBufferBps, setSpreadBufferBps] = useState(5);

  // How fills are priced: the next bar's open, or the real bid/ask on arrival.
  const [fillModel, setFillModel] = useState<"bar" | "quote">("bar");
  const [latencyMs, setLatencyMs] = useState(250);

  // Per-strategy risk budget (matches StrategyForm)
  const [riskBudget, setRiskBudget] = useState<RiskBudgetState>(defaultRiskBudgetState);

  // Risk config overrides (collapsed by default)
  const [showRiskConfig, setShowRiskConfig] = useState(false);
  const [gapBufferBps, setGapBufferBps] = useState(20);
  const [maxIntradayDrawdownPct, setMaxIntradayDrawdownPct] = useState(5);
  const [cashReservePct, setCashReservePct] = useState(5);

  // Populate strategy fields whenever the selected config changes
  useEffect(() => {
    const src: Record<string, unknown> =
      selectedId === "new"
        ? (definition?.defaultConfig ?? {})
        : (strategies.find((s) => s.id === selectedId)?.config ?? {});

    if (Object.keys(src).length === 0) return;

    setGenericConfig({ ...definition?.defaultConfig, ...src });
    setLeg1((src.leg1Symbol as string | undefined) ?? "SPY");
    setLeg2((src.leg2Symbol as string | undefined) ?? "QQQ");
    setEntryZScore((src.entryZScore as number | undefined) ?? 2.0);
    setExitZScore((src.exitZScore as number | undefined) ?? 0.5);
    setRollingWindowMins(Math.round(((src.rollingWindowMs as number | undefined) ?? 3_600_000) / 60_000));
    setTradeNotionalUsd((src.tradeNotionalUsd as number | undefined) ?? 5_000);
    setMaxHoldingMins(Math.round(((src.maxHoldingTimeMs as number | undefined) ?? 86_400_000) / 60_000));
    setCooldownMins(Math.round(((src.cooldownMs as number | undefined) ?? 60_000) / 60_000));
    setHedgeRatioMethod((src.hedgeRatioMethod as "fixed" | "rolling_ols" | undefined) ?? "fixed");
    setOlsWindowMins(Math.round(((src.olsWindowMs as number | undefined) ?? 14_400_000) / 60_000));
    setOlsRecalcIntervalBars((src.olsRecalcIntervalBars as number | undefined) ?? 5);
    const rb = src.riskBudget as { maxCapitalPct?: number; maxOpenOrders?: number; maxOrderNotionalPct?: number } | undefined;
    setRiskBudget({
      maxCapitalPct: Math.round((rb?.maxCapitalPct ?? 0.20) * 100),
      maxOpenOrders: rb?.maxOpenOrders ?? null,
      maxOrderNotionalPct: rb?.maxOrderNotionalPct != null
        ? Math.round(rb.maxOrderNotionalPct * 100)
        : null,
    });
  }, [selectedId, definition, strategies]);

  const orderSizeConflict = useMemo(() => {
    if (type !== "pairs_trading" || riskBudget.maxOrderNotionalPct === null) return undefined;
    const capUsd = initialCapital * (riskBudget.maxOrderNotionalPct / 100);
    if (tradeNotionalUsd > capUsd) {
      return `Trade notional ($${tradeNotionalUsd.toLocaleString()}) exceeds the per-order cap ($${capUsd.toLocaleString()} at ${riskBudget.maxOrderNotionalPct}%). No orders will execute.`;
    }
    return undefined;
  }, [type, riskBudget.maxOrderNotionalPct, tradeNotionalUsd, initialCapital]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedStrategy = strategies.find((s) => s.id === selectedId);

    const strategyConfig: Record<string, unknown> = type !== "pairs_trading" ? {
      ...normalizeParams(genericConfig, definition?.params ?? []), type,
      riskBudget: budgetConfig(riskBudget),
    } : {
        type: "pairs_trading",
        name: `Pairs: ${leg1}/${leg2}`,
        symbols: [leg1, leg2],
        leg1Symbol: leg1,
        leg2Symbol: leg2,
        rollingWindowMs: rollingWindowMins * 60_000,
        maxPositionSizeUsd: 10_000,
        cooldownMs: cooldownMins * 60_000,
        enabled: true,
        hedgeRatioMethod,
        fixedHedgeRatio: 1.0,
        entryZScore,
        exitZScore,
        stopLossZScore: 4.0,
        maxHoldingTimeMs: maxHoldingMins * 60_000,
        minObservations: 30,
        tradeNotionalUsd,
        priceSource: "mid",
        olsWindowMs: olsWindowMins * 60_000,
        olsRecalcIntervalBars,
        riskBudget: budgetConfig(riskBudget),
      };
    const selectedConfig = selectedStrategy ? { ...definition?.defaultConfig, ...selectedStrategy.config, type } : undefined;
    const matchesVersion = selectedConfig && configKey(selectedConfig) === configKey({ ...definition?.defaultConfig, ...strategyConfig });
    await onSubmit({
      name: `${type === "pairs_trading" ? `${leg1}/${leg2} Pairs` : definition?.label ?? type} Backtest ${startDate} to ${endDate}`,
      strategyConfig,
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      initialCapital,
      dataGranularity: "bar",
      commissionPerShare: 0.005,
      ...(fillModel === "quote" && { execution: { model: "quote", latencyMs } }),
      strategyId: selectedStrategy?.id,
      strategyVersionId: matchesVersion ? latestVersionId : undefined,
      riskConfig: {
        gapBufferBps,
        spreadBufferBps,
        maxIntradayDrawdownPct: maxIntradayDrawdownPct / 100,
        cashReservePct: cashReservePct / 100,
      },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Configure Backtest</h3>

      {/* Strategy type + config picker */}
      <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-500">Strategy Type</span>
            {definition?.algorithmVersion != null && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                v{definition.algorithmVersion}
              </span>
            )}
          </div>
          <p className="text-sm">{definition?.label ?? type}</p>
        </div>
        <Field label="Configuration">
          {configsLoading ? (
            <div className="h-8 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
          ) : (
            <select
              className={inputClass}
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="new">New Configuration</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {type !== "pairs_trading" && <>
        <Field label="Configuration name">
          <input aria-label="Configuration name" className={inputClass} value={String(genericConfig.name ?? "")} onChange={(e) => setGenericConfig({ ...genericConfig, name: e.target.value })} required />
        </Field>
        {(definition?.params ?? []).map((spec) => <ParameterField key={spec.key} spec={spec} value={genericConfig[spec.key]} onChange={(value) => setGenericConfig({ ...genericConfig, [spec.key]: value })} />)}
        {definition?.actions?.save.allowed && <button type="button" disabled={saving} className="text-left text-sm underline" onClick={async () => {
          setSaving(true); setFormError(null);
          try {
            const saved = await save(String(genericConfig.name ?? definition.label), {
              ...normalizeParams(genericConfig, definition.params ?? []), type, riskBudget: budgetConfig(riskBudget),
            });
            setSelectedId(saved.id);
          }
          catch (err) { setFormError(err instanceof Error ? err.message : "Could not save configuration"); }
          finally { setSaving(false); }
        }}>{saving ? "Saving?" : "Save as new configuration"}</button>}
        {formError && <p role="alert">{formError}</p>}
      </>}
      {/* Strategy config fields */}
      {type === "pairs_trading" && <div className="grid grid-cols-2 gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
        <Field label="Leg 1">
          <input type="text" value={leg1} onChange={(e) => setLeg1(e.target.value.toUpperCase())} className={inputClass} required />
        </Field>
        <Field label="Leg 2">
          <input type="text" value={leg2} onChange={(e) => setLeg2(e.target.value.toUpperCase())} className={inputClass} required />
        </Field>
        <Field label="Entry Z-Score">
          <input type="number" min="0.5" max="5" step="0.1" value={entryZScore} onChange={(e) => setEntryZScore(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Exit Z-Score">
          <input type="number" min="0" max="2" step="0.1" value={exitZScore} onChange={(e) => setExitZScore(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Spread Window (minutes)">
          <input type="number" min="5" step="5" value={rollingWindowMins} onChange={(e) => setRollingWindowMins(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Trade Notional (USD)">
          <input type="number" min="100" step="100" value={tradeNotionalUsd} onChange={(e) => setTradeNotionalUsd(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Max Holding Time (minutes)">
          <input type="number" min="1" step="1" value={maxHoldingMins} onChange={(e) => setMaxHoldingMins(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Cooldown After Exit (minutes)">
          <input type="number" min="0" step="1" value={cooldownMins} onChange={(e) => setCooldownMins(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Hedge Ratio Method">
          <select value={hedgeRatioMethod} onChange={(e) => setHedgeRatioMethod(e.target.value as "fixed" | "rolling_ols")} className={inputClass}>
            <option value="fixed">Fixed (1:1)</option>
            <option value="rolling_ols">Rolling OLS</option>
          </select>
        </Field>
      </div>}

      {type === "pairs_trading" && hedgeRatioMethod === "rolling_ols" && (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
          <p className="col-span-2 text-xs text-zinc-500">
            OLS estimates the hedge ratio by regressing leg 1 on leg 2 over the window below.
            Use a window 2–4× longer than the spread window for a stable ratio.
          </p>
          <Field label="OLS Window (minutes)">
            <input type="number" min="30" step="30" value={olsWindowMins} onChange={(e) => setOlsWindowMins(Number(e.target.value))} className={inputClass} />
          </Field>
          <Field label="Recalc Every N Bars">
            <input type="number" min="1" max="60" step="1" value={olsRecalcIntervalBars} onChange={(e) => setOlsRecalcIntervalBars(Number(e.target.value))} className={inputClass} />
          </Field>
        </div>
      )}

      {/* Backtest-specific extras */}
      <div className="grid grid-cols-2 gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
        <Field label="Start Date">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} required />
        </Field>
        <Field label="End Date">
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} required />
        </Field>
        <div className="col-span-2">
          <Field label="Initial Capital ($)">
            <input type="number" min="1000" step="1000" value={initialCapital} onChange={(e) => setInitialCapital(Number(e.target.value))} className={inputClass} />
          </Field>
        </div>
      </div>

      {/* Fills */}
      <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Fills</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price Orders At">
            <select value={fillModel} onChange={(e) => setFillModel(e.target.value as "bar" | "quote")} className={inputClass}>
              <option value="bar">Next bar&apos;s open</option>
              <option value="quote">Real bid/ask on arrival</option>
            </select>
          </Field>
          {fillModel === "quote" && (
            <Field label="Order Latency (ms)">
              <input
                type="number"
                min="0"
                max="25000"
                step="50"
                value={latencyMs}
                onChange={(e) => setLatencyMs(Number(e.target.value))}
                className={inputClass}
              />
            </Field>
          )}
        </div>
        <p className="text-xs text-zinc-500">
          {fillModel === "quote"
            ? "Each order trades at the real bid/ask when it reaches the market, the latency after the decision; a resting limit fills only on trades printing through it. The first run fetches about one window of quotes per order from Alpaca; reruns read them from the local cache."
            : "Each order fills at the next bar's open, plus a synthetic spread and slippage."}
        </p>
      </div>

      {/* Portfolio Allocation */}
      <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Portfolio Allocation</p>
        <RiskBudgetSection value={riskBudget} onChange={setRiskBudget} orderSizeConflict={orderSizeConflict} />
      </div>

      {/* Risk Config (collapsible) */}
      <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
        <button
          type="button"
          onClick={() => setShowRiskConfig((v) => !v)}
          className="flex items-center justify-between text-xs font-semibold text-zinc-700 dark:text-zinc-300"
        >
          <span>Risk Config</span>
          <span>{showRiskConfig ? "▲" : "▼"}</span>
        </button>
        {showRiskConfig && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Field label="Gap Buffer (bps)">
              <input
                type="number"
                min="0"
                max="200"
                step="1"
                value={gapBufferBps}
                onChange={(e) => setGapBufferBps(Number(e.target.value))}
                className={inputClass}
              />
            </Field>
            <Field label="Spread Buffer (bps)">
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={spreadBufferBps}
                onChange={(e) => setSpreadBufferBps(Number(e.target.value))}
                className={inputClass}
              />
            </Field>
            <Field label="Max Intraday Drawdown (%)">
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={maxIntradayDrawdownPct}
                onChange={(e) => setMaxIntradayDrawdownPct(Number(e.target.value))}
                className={inputClass}
              />
            </Field>
            <Field label="Cash Reserve (%)">
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={cashReservePct}
                onChange={(e) => setCashReservePct(Number(e.target.value))}
                className={inputClass}
              />
            </Field>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading || configsLoading || !definition}
        className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isLoading ? "Queuing…" : "Run Backtest"}
      </button>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-zinc-500">{label}</label>
      {children}
    </div>
  );
}

function ParameterField({ spec, value, onChange }: { spec: ParamSpec; value: unknown; onChange: (value: unknown) => void }) {
  const id = `backtest-param-${spec.key}`;
  return <div className="flex flex-col gap-1">
    <label htmlFor={id} className="text-xs font-medium text-zinc-500">{spec.label}</label>
    {spec.kind === "boolean" ? <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /> :
      <input id={id} className={inputClass} type={spec.kind === "number" ? "number" : "text"}
        value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
        min={spec.min} max={spec.max} step={spec.step} required
        onChange={(e) => onChange(spec.kind === "number" ? Number(e.target.value) : e.target.value)} />}
    {spec.hint && <p className="text-xs text-zinc-500">{spec.hint}</p>}
  </div>;
}

function normalizeParams(config: Record<string, unknown>, params: ParamSpec[]) {
  const result = { ...config };
  for (const spec of params) {
    if (spec.kind === "symbols" && typeof result[spec.key] === "string") {
      result[spec.key] = (result[spec.key] as string).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return result;
}

// Ignore descriptive fields; compare nested parameters independent of object key order.
function configKey(config: Record<string, unknown>): string {
  const { id: _id, name: _name, ...parameters } = config;
  void _id; void _name;
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]),
    );
    return value;
  };
  return JSON.stringify(ordered(parameters));
}

function budgetConfig(risk: RiskBudgetState) {
  return {
    maxCapitalPct: risk.maxCapitalPct / 100,
    ...(risk.maxOpenOrders !== null && { maxOpenOrders: risk.maxOpenOrders }),
    ...(risk.maxOrderNotionalPct !== null && { maxOrderNotionalPct: risk.maxOrderNotionalPct / 100 }),
  };
}
