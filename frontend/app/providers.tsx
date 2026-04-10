/**
 * app/providers.tsx
 *
 * Global React context providers wrapper. Wraps all pages with the
 * application-wide state stores (strategy, portfolio, system).
 * Add any new global providers here.
 *
 * Inputs:  children React nodes.
 * Outputs: Context-wrapped children.
 */

"use client";

import { useReducer } from "react";
import {
  StrategyStateContext,
  StrategyDispatchContext,
  strategyReducer,
  strategyInitialState,
} from "../state/strategyStore";
import {
  PortfolioStateContext,
  PortfolioDispatchContext,
  portfolioReducer,
  portfolioInitialState,
} from "../state/portfolioStore";
import {
  SystemStateContext,
  SystemDispatchContext,
  systemReducer,
  systemInitialState,
} from "../state/systemStore";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [strategyState, strategyDispatch] = useReducer(strategyReducer, strategyInitialState);
  const [portfolioState, portfolioDispatch] = useReducer(portfolioReducer, portfolioInitialState);
  const [systemState, systemDispatch] = useReducer(systemReducer, systemInitialState);

  return (
    <SystemStateContext.Provider value={systemState}>
      <SystemDispatchContext.Provider value={systemDispatch}>
        <PortfolioStateContext.Provider value={portfolioState}>
          <PortfolioDispatchContext.Provider value={portfolioDispatch}>
            <StrategyStateContext.Provider value={strategyState}>
              <StrategyDispatchContext.Provider value={strategyDispatch}>
                {children}
              </StrategyDispatchContext.Provider>
            </StrategyStateContext.Provider>
          </PortfolioDispatchContext.Provider>
        </PortfolioStateContext.Provider>
      </SystemDispatchContext.Provider>
    </SystemStateContext.Provider>
  );
}
