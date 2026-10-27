import { env } from "./env";
import { STRATEGY_DEFINITIONS, type StrategyDefinition } from "./strategyDefaults";

export interface StrategyPolicyContext {
  profile: "development" | "shared";
  executionTarget: string;
}
export interface StrategyAction { allowed: boolean; reason?: string }

export function runtimeStrategyPolicy(executionTarget?: string): StrategyPolicyContext {
  return { profile: env.strategyPolicyProfile ?? "shared", executionTarget: executionTarget ?? env.executionTarget ?? "sim" };
}

/** Geography and NODE_ENV never grant broker permissions. */
export function strategyActions(def: StrategyDefinition, context: StrategyPolicyContext) {
  const backtest: StrategyAction = def.backtestable === false
    ? { allowed: false, reason: "This strategy does not support the backtest engine." } : { allowed: true };
  const save: StrategyAction = def.status === "ready" || def.status === "experimental"
    ? { allowed: true } : { allowed: false, reason: `Strategy is ${def.status}; new configurations are disabled.` };
  const experimentalTrading = context.profile === "development" && ["sim", "alpaca-paper"].includes(context.executionTarget);
  const startTrading: StrategyAction = def.status === "ready" || (def.status === "experimental" && experimentalTrading)
    ? { allowed: true }
    : { allowed: false, reason: "New trading runs require a ready strategy, except experimental strategies on development sim/personal paper runtimes." };
  return { save, backtest, startTrading };
}

export function strategyDefinition(type: string, context = runtimeStrategyPolicy()) {
  const def = STRATEGY_DEFINITIONS[type];
  return def ? { ...def, actions: strategyActions(def, context) } : undefined;
}

export function visibleStrategyDefinitions(context = runtimeStrategyPolicy()) {
  return Object.values(STRATEGY_DEFINITIONS).filter((def) => !def.hidden && def.status !== "planned")
    .map((def) => ({ ...def, actions: strategyActions(def, context) }));
}
