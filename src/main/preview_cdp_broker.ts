import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { WebContents } from "electron";
import log from "electron-log";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const logger = log.scope("preview_cdp_broker");

const LOOPBACK_HOST = "127.0.0.1";
const MAX_CDP_MESSAGE_BYTES = 4 * 1024 * 1024;
const PREVIEW_PAGE_SESSION_ID = "dyad-preview-page";
const PREVIEW_BROWSER_CONTEXT_ID = "dyad-preview-context";
const PREVIEW_BROWSER_TARGET_ID = "dyad-preview-browser";

type CdpId = number;

interface CdpRequest {
  id: CdpId;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

interface CdpTargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  browserContextId?: string;
  openerId?: string;
}

interface RealTargetInfo {
  targetId?: string;
  browserContextId?: string;
  type?: string;
  title?: string;
  url?: string;
  attached?: boolean;
  openerId?: string;
}

interface BrokerTarget {
  contents: WebContents;
  realTargetId: string;
  url: string;
  generation: number;
  onMessage: (
    event: Electron.Event,
    method: string,
    params: Record<string, unknown>,
    sessionId: string,
  ) => void;
  onDetach: (event: Electron.Event, reason: string) => void;
}

interface BrokerEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

export interface PreviewCdpBrokerConnectionInfo {
  endpoint: string;
  token: string;
}

/** Target commands Playwright needs inside the selected preview session. */
const ALLOWED_PAGE_TARGET_COMMANDS = new Set([
  "Target.getTargetInfo",
  "Target.setAutoAttach",
  "Target.detachFromTarget",
]);

const BROWSER_GLOBAL_DOMAIN_PREFIXES = [
  "Browser.",
  "Memory.",
  "Storage.",
  "SystemInfo.",
  "Tracing.",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseCdpRequest(raw: RawData): CdpRequest | null {
  const text = Array.isArray(raw)
    ? Buffer.concat(raw).toString("utf8")
    : raw instanceof ArrayBuffer
      ? Buffer.from(raw).toString("utf8")
      : raw.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isRecord(parsed) ||
    !Number.isSafeInteger(parsed.id) ||
    typeof parsed.method !== "string" ||
    parsed.method.length === 0 ||
    parsed.method.length > 200 ||
    (parsed.params !== undefined && !isRecord(parsed.params)) ||
    (parsed.sessionId !== undefined && typeof parsed.sessionId !== "string")
  ) {
    return null;
  }
  return parsed as unknown as CdpRequest;
}

function hash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function bearerTokenMatches(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  const supplied = Array.isArray(header) ? header[0] : header;
  return (
    typeof supplied === "string" &&
    timingSafeEqual(hash(supplied), hash(`Bearer ${token}`))
  );
}

function cdpError(id: CdpId, message: string, sessionId?: string) {
  return {
    id,
    error: { code: -32000, message },
    ...(sessionId ? { sessionId } : {}),
  };
}

function cdpResult(
  id: CdpId,
  result: Record<string, unknown>,
  sessionId?: string,
) {
  return { id, result, ...(sessionId ? { sessionId } : {}) };
}

function sanitizedMessage(error: unknown): string {
  if (!(error instanceof Error)) return "CDP command failed";
  // Keep protocol error responses single-line and bounded.
  return error.message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

function isBrowserGlobalCommand(method: string): boolean {
  return BROWSER_GLOBAL_DOMAIN_PREFIXES.some((prefix) =>
    method.startsWith(prefix),
  );
}

function syntheticPageTargetInfo(target: BrokerTarget): CdpTargetInfo {
  return {
    // Chromium uses the page target id as the main frame id. Playwright relies
    // on that equality while constructing its frame tree, so this selected
    // target's id cannot be replaced without rewriting every frame reference.
    targetId: target.realTargetId,
    type: "page",
    title: "Dyad test preview",
    url: target.url,
    attached: true,
    browserContextId: PREVIEW_BROWSER_CONTEXT_ID,
  };
}

function syntheticBrowserTargetInfo(): CdpTargetInfo {
  return {
    targetId: PREVIEW_BROWSER_TARGET_ID,
    type: "browser",
    title: "Dyad preview broker",
    url: "",
    attached: true,
  };
}

/**
 * A run-scoped, one-target CDP endpoint for Playwright.
 *
 * This is intentionally not a transparent proxy. It creates a synthetic
 * browser with exactly one representable page and rejects browser-global
 * commands that could enumerate or attach to Dyad's other WebContents.
 */
export class PreviewCdpBroker {
  readonly token = randomBytes(32).toString("base64url");

  private readonly websocketPath = `/devtools/browser/${randomUUID()}`;
  private readonly websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_CDP_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  private httpServer: HttpServer | null = null;
  private client: WebSocket | null = null;
  private target: BrokerTarget | null = null;
  private targetGeneration = 0;
  private endpointValue: string | null = null;
  private closed = false;
  private realToSyntheticSessions = new Map<string, string>();
  private syntheticToRealSessions = new Map<string, string>();
  private realToSyntheticTargets = new Map<string, string>();

  get connectionInfo(): PreviewCdpBrokerConnectionInfo {
    if (!this.endpointValue) {
      throw new Error("Preview CDP broker has not started");
    }
    return { endpoint: this.endpointValue, token: this.token };
  }

  async start(): Promise<void> {
    if (this.closed) throw new Error("Preview CDP broker is closed");
    if (this.httpServer) return;

    const server = createServer((request, response) => {
      if (!bearerTokenMatches(request, this.token)) {
        response.writeHead(401, { "Content-Type": "text/plain" });
        response.end("Unauthorized");
        return;
      }
      if (
        request.method !== "GET" ||
        (request.url !== "/json/version" && request.url !== "/json/version/")
      ) {
        response.writeHead(404, { "Content-Type": "text/plain" });
        response.end("Not found");
        return;
      }
      if (!this.target) {
        response.writeHead(503, { "Content-Type": "text/plain" });
        response.end("Preview target is not ready");
        return;
      }
      const address = server.address() as AddressInfo | null;
      if (!address) {
        response.writeHead(503, { "Content-Type": "text/plain" });
        response.end("Preview broker is not listening");
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify({
          Browser: "DyadPreview/1.0",
          "Protocol-Version": "1.3",
          webSocketDebuggerUrl: `ws://${LOOPBACK_HOST}:${address.port}${this.websocketPath}`,
        }),
      );
    });

    server.on("upgrade", (request, socket, head) => {
      if (
        request.url !== this.websocketPath ||
        !bearerTokenMatches(request, this.token) ||
        !this.target ||
        this.client
      ) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        this.websocketServer.emit("connection", websocket, request);
      });
    });

    this.websocketServer.on("connection", (websocket) => {
      if (this.closed || !this.target || this.client) {
        websocket.close(1013, "Preview broker unavailable");
        return;
      }
      this.client = websocket;
      websocket.on("message", (raw) => {
        void this.handleClientMessage(websocket, raw);
      });
      websocket.once("close", () => {
        if (this.client === websocket) this.client = null;
      });
      websocket.once("error", (error) => {
        logger.debug("Preview CDP client disconnected with an error", error);
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, LOOPBACK_HOST);
    });

    const address = server.address() as AddressInfo | null;
    if (!address) {
      server.close();
      throw new Error(
        "Preview CDP broker failed to resolve its listening port",
      );
    }
    this.httpServer = server;
    this.endpointValue = `http://${LOOPBACK_HOST}:${address.port}`;
  }

  async setTarget(contents: WebContents): Promise<void> {
    if (this.closed) throw new Error("Preview CDP broker is closed");
    if (!this.httpServer) throw new Error("Preview CDP broker has not started");
    if (contents.isDestroyed()) throw new Error("Preview target was destroyed");

    this.releaseTarget();

    contents.debugger.attach("1.3");
    const generation = ++this.targetGeneration;
    const onMessage = (
      _event: Electron.Event,
      method: string,
      params: Record<string, unknown>,
      realSessionId: string,
    ) => {
      if (this.target?.generation !== generation) return;
      this.forwardDebuggerEvent({ method, params, sessionId: realSessionId });
    };
    const onDetach = (_event: Electron.Event, reason: string) => {
      if (this.target?.generation !== generation) return;
      logger.warn(`Preview debugger detached: ${reason}`);
      void this.close().catch((error) => {
        logger.warn("Failed to close detached preview broker", error);
      });
    };
    contents.debugger.on("message", onMessage);
    contents.debugger.once("detach", onDetach);

    try {
      const response = (await contents.debugger.sendCommand(
        "Target.getTargetInfo",
      )) as { targetInfo?: RealTargetInfo };
      const contextId = response.targetInfo?.browserContextId;
      const targetId = response.targetInfo?.targetId;
      if (!contextId || !targetId) {
        throw new Error("Preview target has no isolated browser context");
      }
      this.target = {
        contents,
        realTargetId: targetId,
        url: contents.getURL(),
        generation,
        onMessage,
        onDetach,
      };
    } catch (error) {
      contents.debugger.removeListener("message", onMessage);
      contents.debugger.removeListener("detach", onDetach);
      if (contents.debugger.isAttached()) contents.debugger.detach();
      throw error;
    }
  }

  /**
   * Detaches an expected-to-be-destroyed preview without closing the broker.
   * The test batch uses this immediately before rotating to its next isolated
   * WebContentsView. Unexpected debugger detachments still close the broker.
   */
  releaseTarget(): void {
    if (this.closed) throw new Error("Preview CDP broker is closed");
    this.disconnectClient("Preview target changed");
    this.detachTarget();
    this.clearTargetMappings();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.disconnectClient("Preview automation ended");
    this.detachTarget();
    this.clearTargetMappings();
    const server = this.httpServer;
    this.httpServer = null;
    this.endpointValue = null;
    this.websocketServer.close();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private disconnectClient(reason: string): void {
    const client = this.client;
    this.client = null;
    if (client && client.readyState < WebSocket.CLOSING) {
      client.close(1012, reason);
    }
  }

  private detachTarget(): void {
    const target = this.target;
    this.target = null;
    if (!target) return;
    const { debugger: targetDebugger } = target.contents;
    targetDebugger.removeListener("message", target.onMessage);
    targetDebugger.removeListener("detach", target.onDetach);
    try {
      if (targetDebugger.isAttached()) targetDebugger.detach();
    } catch (error) {
      logger.debug("Failed to detach preview debugger", error);
    }
  }

  private clearTargetMappings(): void {
    this.realToSyntheticSessions.clear();
    this.syntheticToRealSessions.clear();
    this.realToSyntheticTargets.clear();
  }

  private send(payload: unknown): void {
    if (this.client?.readyState === WebSocket.OPEN) {
      this.client.send(JSON.stringify(payload));
    }
  }

  private async handleClientMessage(
    websocket: WebSocket,
    raw: RawData,
  ): Promise<void> {
    if (websocket !== this.client) return;
    const request = parseCdpRequest(raw);
    if (!request) {
      websocket.close(1003, "Invalid CDP message");
      return;
    }
    const target = this.target;
    if (!target || target.contents.isDestroyed()) {
      this.send(
        cdpError(
          request.id,
          "Preview target is unavailable",
          request.sessionId,
        ),
      );
      return;
    }

    try {
      const result = await this.routeCommand(request, target);
      if (websocket === this.client && target === this.target) {
        this.send(cdpResult(request.id, result, request.sessionId));
      }
    } catch (error) {
      if (websocket === this.client) {
        this.send(
          cdpError(request.id, sanitizedMessage(error), request.sessionId),
        );
      }
    }
  }

  private async routeCommand(
    request: CdpRequest,
    target: BrokerTarget,
  ): Promise<Record<string, unknown>> {
    if (!request.sessionId) {
      return this.routeBrowserCommand(request, target);
    }
    if (request.sessionId === PREVIEW_PAGE_SESSION_ID) {
      return this.routePageCommand(request, target);
    }
    const realSessionId = this.syntheticToRealSessions.get(request.sessionId);
    if (!realSessionId) throw new Error("Unknown preview CDP session");
    if (isBrowserGlobalCommand(request.method)) {
      throw new Error("Browser-global CDP commands are not available");
    }
    if (request.method.startsWith("Target.")) {
      return this.routeChildTargetCommand(request, target, realSessionId);
    }
    return (await target.contents.debugger.sendCommand(
      request.method,
      request.params,
      realSessionId,
    )) as Record<string, unknown>;
  }

  private async routeBrowserCommand(
    request: CdpRequest,
    target: BrokerTarget,
  ): Promise<Record<string, unknown>> {
    if (request.method === "Target.setAutoAttach") {
      queueMicrotask(() => {
        if (this.target !== target) return;
        this.send({
          method: "Target.attachedToTarget",
          params: {
            sessionId: PREVIEW_PAGE_SESSION_ID,
            targetInfo: syntheticPageTargetInfo(target),
            waitingForDebugger: false,
          },
        });
      });
      return {};
    }
    if (request.method === "Target.getTargetInfo") {
      return { targetInfo: syntheticBrowserTargetInfo() };
    }
    if (request.method.startsWith("Target.")) {
      throw new Error("Only the selected preview target is available");
    }
    if (request.method === "Browser.getVersion") {
      const version = (await target.contents.debugger.sendCommand(
        "Browser.getVersion",
      )) as Record<string, unknown>;
      return {
        protocolVersion: version.protocolVersion ?? "1.3",
        product: version.product ?? "Chrome/0",
        revision: version.revision ?? "",
        userAgent: version.userAgent ?? "DyadPreview",
        jsVersion: version.jsVersion ?? "",
      };
    }
    if (request.method === "Browser.setDownloadBehavior") {
      // Playwright always sends this while adopting a persistent context.
      // Electron's target-scoped debugger cannot address that context through
      // Browser.setDownloadBehavior, and forwarding it without a context would
      // mutate process-global browser state. Keep the browser default instead.
      return {};
    }
    if (request.method === "Storage.getCookies") {
      return (await target.contents.debugger.sendCommand(
        "Network.getAllCookies",
      )) as Record<string, unknown>;
    }
    if (request.method === "Storage.setCookies") {
      return (await target.contents.debugger.sendCommand("Network.setCookies", {
        cookies: request.params?.cookies ?? [],
      })) as Record<string, unknown>;
    }
    if (request.method === "Storage.clearCookies") {
      return (await target.contents.debugger.sendCommand(
        "Network.clearBrowserCookies",
      )) as Record<string, unknown>;
    }
    throw new Error("Browser-global CDP command is not available");
  }

  private async routePageCommand(
    request: CdpRequest,
    target: BrokerTarget,
  ): Promise<Record<string, unknown>> {
    if (request.method === "Target.getTargetInfo") {
      return { targetInfo: syntheticPageTargetInfo(target) };
    }
    if (request.method === "Target.detachFromTarget") {
      const syntheticSessionId = request.params?.sessionId;
      if (typeof syntheticSessionId !== "string") {
        throw new Error("A preview child session is required");
      }
      const realSessionId =
        this.syntheticToRealSessions.get(syntheticSessionId);
      if (!realSessionId) throw new Error("Unknown preview child session");
      const result = (await target.contents.debugger.sendCommand(
        request.method,
        { sessionId: realSessionId },
      )) as Record<string, unknown>;
      this.syntheticToRealSessions.delete(syntheticSessionId);
      this.realToSyntheticSessions.delete(realSessionId);
      return result;
    }
    if (
      request.method.startsWith("Target.") &&
      !ALLOWED_PAGE_TARGET_COMMANDS.has(request.method)
    ) {
      throw new Error("Cross-target CDP commands are not available");
    }
    if (isBrowserGlobalCommand(request.method)) {
      throw new Error("Browser-global CDP commands are not available");
    }
    return (await target.contents.debugger.sendCommand(
      request.method,
      request.params,
    )) as Record<string, unknown>;
  }

  private async routeChildTargetCommand(
    request: CdpRequest,
    target: BrokerTarget,
    realSessionId: string,
  ): Promise<Record<string, unknown>> {
    if (request.method === "Target.getTargetInfo") {
      const response = (await target.contents.debugger.sendCommand(
        request.method,
        request.params,
        realSessionId,
      )) as { targetInfo?: RealTargetInfo };
      const targetInfo = response.targetInfo;
      if (!targetInfo?.targetId) {
        throw new Error("Preview child target is unavailable");
      }
      return {
        targetInfo: {
          ...targetInfo,
          targetId: this.publicTargetId(targetInfo.targetId, target),
          ...(typeof targetInfo.openerId === "string"
            ? { openerId: this.publicTargetId(targetInfo.openerId, target) }
            : {}),
          browserContextId: PREVIEW_BROWSER_CONTEXT_ID,
        },
      };
    }
    if (request.method !== "Target.setAutoAttach") {
      throw new Error("Cross-target CDP commands are not available");
    }
    return (await target.contents.debugger.sendCommand(
      request.method,
      request.params,
      realSessionId,
    )) as Record<string, unknown>;
  }

  private forwardDebuggerEvent(event: BrokerEvent): void {
    if (!this.client || !this.target) return;

    let sessionId = PREVIEW_PAGE_SESSION_ID;
    if (event.sessionId) {
      sessionId = this.syntheticSessionId(event.sessionId);
    }

    if (event.method === "Target.attachedToTarget") {
      const realChildSessionId = event.params.sessionId;
      const realTargetInfo = event.params.targetInfo;
      if (
        typeof realChildSessionId !== "string" ||
        !isRecord(realTargetInfo) ||
        typeof realTargetInfo.targetId !== "string"
      ) {
        return;
      }
      const childSessionId = this.syntheticSessionId(realChildSessionId);
      const childTargetId = this.publicTargetId(
        realTargetInfo.targetId,
        this.target,
      );
      this.send({
        method: event.method,
        params: {
          ...event.params,
          sessionId: childSessionId,
          targetInfo: {
            ...realTargetInfo,
            targetId: childTargetId,
            ...(typeof realTargetInfo.openerId === "string"
              ? {
                  openerId: this.publicTargetId(
                    realTargetInfo.openerId,
                    this.target,
                  ),
                }
              : {}),
            browserContextId: PREVIEW_BROWSER_CONTEXT_ID,
          },
        },
        sessionId,
      });
      return;
    }

    if (event.method === "Target.detachedFromTarget") {
      const realChildSessionId = event.params.sessionId;
      const realTargetId = event.params.targetId;
      const childSessionId =
        typeof realChildSessionId === "string"
          ? this.realToSyntheticSessions.get(realChildSessionId)
          : undefined;
      if (!childSessionId) return;
      this.send({
        method: event.method,
        params: {
          ...event.params,
          sessionId: childSessionId,
          ...(typeof realTargetId === "string"
            ? { targetId: this.publicTargetId(realTargetId, this.target) }
            : {}),
        },
        sessionId,
      });
      if (typeof realChildSessionId === "string") {
        this.realToSyntheticSessions.delete(realChildSessionId);
      }
      this.syntheticToRealSessions.delete(childSessionId);
      return;
    }

    if (event.method.startsWith("Target.")) {
      // Do not forward browser discovery events that could carry process-wide
      // target metadata. Child attach/detach above are the only Target events
      // needed by Playwright's page session.
      return;
    }

    this.send({
      method: event.method,
      params: event.params,
      sessionId,
    });
  }

  private syntheticSessionId(realSessionId: string): string {
    const existing = this.realToSyntheticSessions.get(realSessionId);
    if (existing) return existing;
    const synthetic = `preview-session-${randomUUID()}`;
    this.realToSyntheticSessions.set(realSessionId, synthetic);
    this.syntheticToRealSessions.set(synthetic, realSessionId);
    return synthetic;
  }

  private syntheticTargetId(realTargetId: string): string {
    const existing = this.realToSyntheticTargets.get(realTargetId);
    if (existing) return existing;
    const synthetic = `preview-target-${randomUUID()}`;
    this.realToSyntheticTargets.set(realTargetId, synthetic);
    return synthetic;
  }

  private publicTargetId(realTargetId: string, target: BrokerTarget): string {
    return realTargetId === target.realTargetId
      ? target.realTargetId
      : this.syntheticTargetId(realTargetId);
  }
}
