"use client";

import { useCallback, useEffect, useState } from "react";
import { defaultResultsClient } from "./client";
import type { MomentumResultsClient, MomentumResultsSummary } from "./types";

export function useMomentumResults(client: MomentumResultsClient = defaultResultsClient) {
  const [data, setData] = useState<MomentumResultsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    try {
      setData(await client.getSummary());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load research results");
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, error, isLoading, refetch };
}
