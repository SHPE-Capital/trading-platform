/**
 * Data-fetch seam for the results view. Swapping mock for the P3-1 API is one
 * line: change `defaultResultsClient` to `createHttpResultsClient()`.
 */
import { buildMockSummary } from "./mockData";
import type { MomentumResultsClient, MomentumResultsSummary } from "./types";

export const mockResultsClient: MomentumResultsClient = {
  async getSummary() {
    return buildMockSummary();
  },
};

/** The default path is a placeholder: P3-1 decides the real route. */
export function createHttpResultsClient(url = "/api/momentum/results/summary"): MomentumResultsClient {
  return {
    async getSummary(): Promise<MomentumResultsSummary> {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load research results (${res.status})`);
      return (await res.json()) as MomentumResultsSummary;
    },
  };
}

export const defaultResultsClient: MomentumResultsClient = mockResultsClient;
