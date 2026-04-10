/**
 * state/strategyStore.ts
 *
 * Global frontend state for strategies using React Context + useReducer.
 * Provides a central store for strategy run data accessible across pages.
 *
 * Inputs:  Actions dispatched from hooks and components.
 * Outputs: StrategyRun[] state consumed by strategy-related pages.
 */

"use client";

import { createContext, useContext, useReducer, type Dispatch } from "react";
import type { StrategyRun } from "../types/strategy";

interface StrategyState {
  runs: StrategyRun[];
  selectedRunId: string | null;
  isLoading: boolean;
  error: string | null;
}

type StrategyAction =
  | { type: "SET_RUNS"; runs: StrategyRun[] }
  | { type: "SET_SELECTED"; id: string | null }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null };

function strategyReducer(state: StrategyState, action: StrategyAction): StrategyState {
  switch (action.type) {
    case "SET_RUNS":    return { ...state, runs: action.runs, isLoading: false };
    case "SET_SELECTED": return { ...state, selectedRunId: action.id };
    case "SET_LOADING": return { ...state, isLoading: action.loading };
    case "SET_ERROR":   return { ...state, error: action.error, isLoading: false };
    default:            return state;
  }
}

const initialState: StrategyState = {
  runs: [],
  selectedRunId: null,
  isLoading: false,
  error: null,
};

export const StrategyStateContext = createContext<StrategyState>(initialState);
export const StrategyDispatchContext = createContext<Dispatch<StrategyAction>>(() => {});

export function useStrategyState(): StrategyState {
  return useContext(StrategyStateContext);
}

export function useStrategyDispatch(): Dispatch<StrategyAction> {
  return useContext(StrategyDispatchContext);
}

export { strategyReducer, initialState as strategyInitialState };
export type { StrategyState, StrategyAction };
