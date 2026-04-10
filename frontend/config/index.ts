/**
 * config/index.ts
 *
 * Frontend application configuration. Reads public environment variables
 * (NEXT_PUBLIC_*) and exports them as a typed config object.
 *
 * All process.env access in the frontend goes through this module.
 */

export const config = {
  /** Backend API base URL */
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api",

  /** Whether live WebSocket push updates are enabled */
  enableWebSocket: process.env.NEXT_PUBLIC_ENABLE_WEBSOCKET === "true",

  /** WebSocket endpoint for live engine updates */
  wsBaseUrl: process.env.NEXT_PUBLIC_WS_BASE_URL ?? "ws://localhost:3001",

  /** App name for display */
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "SHPE Capital Trading Platform",
} as const;
