"use client";

import { useCallback, useEffect, useState } from "react";
import { mockMomentumSource } from "./mockData";
import type { MomentumDataSource, MomentumLiveSnapshot } from "./types";

/** Loads the live snapshot from a data source (mock until P3-1 lands). */
export function useMomentumLive(source: MomentumDataSource = mockMomentumSource) {
  const [data, setData] = useState<MomentumLiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    try {
      setData(await source.getLive());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load momentum status");
    } finally {
      setIsLoading(false);
    }
  }, [source]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, error, isLoading, refetch };
}
