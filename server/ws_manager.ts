/**
 * WebSocket Manager for ProteaAI Web Server
 *
 * Manages WebSocket connections and provides broadcast/per-session messaging,
 * replacing Electron's event.sender.send() for push events to the client.
 *
 * Connections are authenticated via JWT query param: ws://host/ws?token=<jwt>
 * Unauthenticated connections are rejected with close code 4001.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { verifyToken } from "./utils/jwt";

interface WsMessage {
  channel: string;
  payload: unknown;
}

interface AuthenticatedWebSocket extends WebSocket {
  userId: string;
}

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients = new Set<AuthenticatedWebSocket>();

  /** Attach the WebSocket server to an HTTP server */
  attach(httpServer: Server): void {
    this.wss = new WebSocketServer({ server: httpServer, path: "/ws" });

    this.wss.on("connection", (ws: WebSocket, req) => {
      // Extract and verify JWT from ?token= query param
      const url = new URL(req.url ?? "/", "http://x");
      const token = url.searchParams.get("token");
      const verified = token ? verifyToken(token) : null;

      if (!verified) {
        ws.close(4001, "Unauthorized");
        return;
      }

      const authWs = ws as AuthenticatedWebSocket;
      authWs.userId = verified.userId;
      this.clients.add(authWs);

      authWs.on("close", () => this.clients.delete(authWs));
      authWs.on("error", () => this.clients.delete(authWs));
    });
  }

  /** Send a message to all clients belonging to a specific user */
  broadcastToUser(userId: string, channel: string, payload: unknown): void {
    const msg = JSON.stringify({ channel, payload } satisfies WsMessage);
    for (const client of this.clients) {
      if (client.userId === userId && client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  /**
   * Send a message to ALL connected authenticated clients.
   * Prefer broadcastToUser() when the target user is known.
   */
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
