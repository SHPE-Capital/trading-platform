/**
 * state/portfolioStore.ts
 *
 * Global frontend state for portfolio data using React Context + useReducer.
 *
 * Inputs:  Actions from hooks and portfolio components.
 * Outputs: PortfolioSnapshot and equityCurve state consumed by portfolio pages.
 */

"use client";

import { createContext, useContext, useReducer, type Dispatch } from "react";
import type { PortfolioSnapshot } from "../types/portfolio";

interface PortfolioState {
  snapshot: PortfolioSnapshot | null;
  equityCurve: PortfolioSnapshot[];
  isLoading: boolean;
  error: string | null;
}

type PortfolioAction =
  | { type: "SET_SNAPSHOT"; snapshot: PortfolioSnapshot }
  | { type: "SET_EQUITY_CURVE"; curve: PortfolioSnapshot[] }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null };

function portfolioReducer(state: PortfolioState, action: PortfolioAction): PortfolioState {
  switch (action.type) {
    case "SET_SNAPSHOT":     return { ...state, snapshot: action.snapshot, isLoading: false };
    case "SET_EQUITY_CURVE": return { ...state, equityCurve: action.curve };
    case "SET_LOADING":      return { ...state, isLoading: action.loading };
    case "SET_ERROR":        return { ...state, error: action.error, isLoading: false };
    default:                 return state;
  }
}

const initialState: PortfolioState = {
  snapshot: null,
  equityCurve: [],
  isLoading: false,
  error: null,
};

export const PortfolioStateContext = createContext<PortfolioState>(initialState);
export const PortfolioDispatchContext = createContext<Dispatch<PortfolioAction>>(() => {});

export function usePortfolioState(): PortfolioState {
  return useContext(PortfolioStateContext);
}

export function usePortfolioDispatch(): Dispatch<PortfolioAction> {
  return useContext(PortfolioDispatchContext);
}

export { portfolioReducer, initialState as portfolioInitialState };
export type { PortfolioState, PortfolioAction };
