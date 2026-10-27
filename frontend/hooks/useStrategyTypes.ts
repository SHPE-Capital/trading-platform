/**
 * hooks/useStrategyTypes.ts
 *
 * Loads visible catalog entries and their operation eligibility. A failed load
 * returns an empty list, so the strategies page falls back to pairs trading.
 */

"use client";

import { useState, useEffect } from "react";
import { fetchStrategyTypes } from "../services/strategiesService";
import type { StrategyDefinition } from "../types/strategy";

export function useStrategyTypes(): { types: StrategyDefinition[]; isLoading: boolean } {
  const [types, setTypes] = useState<StrategyDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchStrategyTypes()
      .then((list) => { if (!cancelled) setTypes(list); })
      .catch(() => { /* picker degrades to the default form */ })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { types, isLoading };
}
