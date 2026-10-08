import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["__tests__/**/*.test.{ts,tsx}"],
    // Tests must never reach a real backend or Supabase project.
    env: {
      NEXT_PUBLIC_API_BASE_URL: "http://api.test/api",
      NEXT_PUBLIC_BACKTEST_API_BASE_URL: "http://backtest.test/api",
    },
  },
});
