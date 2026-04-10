/**
 * state/systemStore.ts
 *
 * Global frontend state for system health and engine status.
 *
 * Inputs:  System status API responses.
 * Outputs: SystemStatus state consumed by the Navbar/health indicators.
 */

"use client";

import { createContext, useContext, useReducer, type Dispatch } from "react";
import type { SystemStatus } from "../types/api";

interface SystemState {
  status: SystemStatus | null;
  isLoading: boolean;
  error: string | null;
}

type SystemAction =
  | { type: "SET_STATUS"; status: SystemStatus }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null };

function systemReducer(state: SystemState, action: SystemAction): SystemState {
  switch (action.type) {
    case "SET_STATUS":  return { ...state, status: action.status, isLoading: false };
    case "SET_LOADING": return { ...state, isLoading: action.loading };
    case "SET_ERROR":   return { ...state, error: action.error, isLoading: false };
    default:            return state;
  }
}

const initialState: SystemState = { status: null, isLoading: false, error: null };

export const SystemStateContext = createContext<SystemState>(initialState);
export const SystemDispatchContext = createContext<Dispatch<SystemAction>>(() => {});

export function useSystemState(): SystemState {
  return useContext(SystemStateContext);
}

export function useSystemDispatch(): Dispatch<SystemAction> {
  return useContext(SystemDispatchContext);
}

export { systemReducer, initialState as systemInitialState };
export type { SystemState, SystemAction };
