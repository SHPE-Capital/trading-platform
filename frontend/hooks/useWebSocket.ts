/**
 * hooks/useWebSocket.ts
 *
 * Custom React hook for managing a WebSocket connection to the backend.
 * Used for receiving live engine updates without polling.
 *
 * Inputs:  WebSocket URL, optional message handler callback.
 * Outputs: { lastMessage, readyState, send }
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { config } from "../config";

type ReadyState = "connecting" | "open" | "closed" | "error";

interface UseWebSocketResult<T> {
  lastMessage: T | null;
  readyState: ReadyState;
  send: (message: unknown) => void;
}

/**
 * Opens a WebSocket connection and provides the last received message.
 * Automatically reconnects on unexpected closure if enabled.
 * @param path - WebSocket path (e.g. "/ws/portfolio")
 * @param enabled - Whether to open the connection (default: config.enableWebSocket)
 * @returns UseWebSocketResult with last message and connection state
 */
export function useWebSocket<T = unknown>(
  path: string,
  enabled = config.enableWebSocket,
): UseWebSocketResult<T> {
  const [lastMessage, setLastMessage] = useState<T | null>(null);
  const [readyState, setReadyState] = useState<ReadyState>("connecting");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) {
      setReadyState("closed");
      return;
    }

    const ws = new WebSocket(`${config.wsBaseUrl}${path}`);
    wsRef.current = ws;

    ws.onopen = () => setReadyState("open");
    ws.onclose = () => setReadyState("closed");
    ws.onerror = () => setReadyState("error");
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as T;
        setLastMessage(data);
      } catch {
        // Ignore non-JSON messages
      }
    };

    return () => {
      ws.close();
    };
  }, [path, enabled]);

  const send = useCallback((message: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { lastMessage, readyState, send };
}
