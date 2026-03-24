/**
 * WebSocket Manager for ProteaAI Web Server
 *
 * Manages WebSocket connections and provides broadcast/per-session messaging,
 * replacing Electron's event.sender.send() for push events to the client.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

interface WsMessage {
  channel: string;
  payload: unknown;
}

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();

  /** Attach the WebSocket server to an HTTP server */
  attach(httpServer: Server): void {
    this.wss = new WebSocketServer({ server: httpServer, path: "/ws" });

    this.wss.on("connection", (ws: WebSocket) => {
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));
      ws.on("error", () => this.clients.delete(ws));
    });
  }

  /** Send a message to all connected clients (broadcast) */
  broadcast(channel: string, payload: unknown): void {
    const msg = JSON.stringify({ channel, payload } satisfies WsMessage);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  /** Number of connected clients */
  get connectionCount(): number {
    return this.clients.size;
  }
}

export const wsManager = new WebSocketManager();
