"use client";

import { createContext, useContext } from "react";
import { usePortfolio } from "../hooks/usePortfolio";
import { useStrategies } from "../hooks/useStrategies";
import { useSystemHealth } from "../hooks/useSystemHealth";
import type { PortfolioSnapshot } from "../types/portfolio";
import type { StrategyRun, PairsStrategyConfig } from "../types/strategy";
import type { SystemStatus } from "../types/api";

interface PortfolioData {
  snapshot: PortfolioSnapshot | null;
  equityCurve: PortfolioSnapshot[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

interface StrategiesData {
  runs: StrategyRun[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  startStrategy: (config: Omit<PairsStrategyConfig, "id">) => Promise<void>;
  stopStrategy: (id: string) => Promise<void>;
}

interface SystemHealthData {
  status: SystemStatus | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const PortfolioContext = createContext<PortfolioData>({
  snapshot: null,
  equityCurve: [],
  isLoading: true,
  error: null,
  refetch: () => {},
});

const StrategiesContext = createContext<StrategiesData>({
  runs: [],
  isLoading: true,
  error: null,
  refetch: () => {},
  startStrategy: async () => {},
  stopStrategy: async () => {},
});

const SystemHealthContext = createContext<SystemHealthData>({
  status: null,
  isLoading: true,
  error: null,
  refetch: () => {},
});

export function DataProvider({ children }: { children: React.ReactNode }) {
  const portfolio = usePortfolio();
  const strategies = useStrategies();
  const systemHealth = useSystemHealth();

  return (
    <PortfolioContext.Provider value={portfolio}>
      <StrategiesContext.Provider value={strategies}>
        <SystemHealthContext.Provider value={systemHealth}>
          {children}
        </SystemHealthContext.Provider>
      </StrategiesContext.Provider>
    </PortfolioContext.Provider>
  );
}

export const usePortfolioData = () => useContext(PortfolioContext);
export const useStrategiesData = () => useContext(StrategiesContext);
export const useSystemHealthData = () => useContext(SystemHealthContext);
