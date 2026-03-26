/**
 * ProteaAI Web IPC Adapter
 *
 * Injects a `window.electron` shim that mirrors the Electron preload API
 * but uses HTTP (for invoke) and WebSocket (for push events) instead of IPC.
 *
 * Import this module BEFORE the React app initializes when running in web mode.
 *
 * Usage: imported by web-entry.tsx (the web build entry point).
 */

const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ??
  `ws://${window.location.host}/ws`;

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  `${window.location.origin}/api`;

// ── WebSocket connection (for push events) ───────────────────────────────────

let ws: WebSocket | null = null;
const eventListeners = new Map<string, Set<(...args: unknown[]) => void>>();

function getOrCreateWs(): WebSocket {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;

  ws = new WebSocket(WS_URL);

  ws.onmessage = (event) => {
    try {
      const { channel, payload } = JSON.parse(event.data as string) as {
        channel: string;
        payload: unknown;
      };
      const listeners = eventListeners.get(channel);
      if (listeners) {
        for (const listener of listeners) {
          listener(payload);
        }
      }
    } catch {
      // ignore malformed messages
    }
  };

  ws.onclose = () => {
    // Reconnect after 2 seconds
    setTimeout(() => { ws = null; }, 2000);
  };

  return ws;
}

const TOKEN_KEY = "proteaai_token";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── IPC invoke → HTTP POST ───────────────────────────────────────────────────

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const input = args[0] ?? {};
  const response = await fetch(`${API_BASE}/${channel}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(input),
  });

  const json = (await response.json()) as
    | { ok: true; data: unknown }
    | { ok: false; error: string };

  if (!json.ok) {
    throw new Error(json.error);
  }
  return json.data;
}

// ── IPC on → WebSocket subscription ─────────────────────────────────────────

function on(
  channel: string,
  listener: (...args: unknown[]) => void,
): () => void {
  // Ensure WebSocket is open so we receive events
  getOrCreateWs();

  if (!eventListeners.has(channel)) {
    eventListeners.set(channel, new Set());
  }
  eventListeners.get(channel)!.add(listener);

  return () => {
    eventListeners.get(channel)?.delete(listener);
  };
}

function removeAllListeners(channel: string): void {
  eventListeners.delete(channel);
}

function removeListener(
  channel: string,
  listener: (...args: unknown[]) => void,
): void {
  eventListeners.get(channel)?.delete(listener);
}

// ── Zoom shim (no-op in web mode) ────────────────────────────────────────────

const webFrame = {
  setZoomFactor(_factor: number): void {
    // no-op: browser handles zoom via CSS transform or native browser zoom
  },
  getZoomFactor(): number {
    return window.devicePixelRatio ?? 1;
  },
};

// ── Inject window.electron ───────────────────────────────────────────────────

(window as unknown as Record<string, unknown>).electron = {
  ipcRenderer: {
    invoke,
    on,
    removeAllListeners,
    removeListener,
  },
  webFrame,
};
