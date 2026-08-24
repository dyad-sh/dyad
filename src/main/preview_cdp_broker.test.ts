// @vitest-environment node

import { EventEmitter, once } from "node:events";
import type { WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { PreviewCdpBroker } from "./preview_cdp_broker";

interface SentCommand {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

class FakeDebugger extends EventEmitter {
  attached = false;
  commands: SentCommand[] = [];

  attach(): void {
    if (this.attached) throw new Error("already attached");
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.emit("detach", {}, "target closed");
  }

  isAttached(): boolean {
    return this.attached;
  }

  async sendCommand(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    this.commands.push({ method, params, sessionId });
    if (method === "Target.getTargetInfo") {
      return {
        targetInfo: {
          targetId: "real-preview-target",
          browserContextId: "real-preview-context",
          type: "page",
          title: "Secret real title",
          url: "http://localhost:32100/",
          attached: true,
        },
      };
    }
    if (method === "Browser.getVersion") {
      return {
        protocolVersion: "1.3",
        product: "Chrome/140.0.0.0",
        revision: "revision",
        userAgent: "Fake Chrome",
        jsVersion: "14.0",
      };
    }
    if (method === "Runtime.evaluate") {
      return { result: { type: "number", value: 42 } };
    }
    if (method === "Network.getAllCookies") return { cookies: [] };
    return {};
  }
}

function fakeContents(targetDebugger: FakeDebugger): WebContents {
  return {
    debugger: targetDebugger,
    getURL: () => "http://localhost:32100/",
    isDestroyed: () => false,
  } as unknown as WebContents;
}

interface CdpMessage {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function connect(broker: PreviewCdpBroker): Promise<{
  socket: WebSocket;
  messages: CdpMessage[];
  command: (
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ) => Promise<CdpMessage>;
}> {
  const { endpoint, token } = broker.connectionInfo;
  const versionResponse = await fetch(`${endpoint}/json/version/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(versionResponse.status).toBe(200);
  const version = (await versionResponse.json()) as {
    webSocketDebuggerUrl: string;
  };
  const socket = new WebSocket(version.webSocketDebuggerUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await once(socket, "open");

  const messages: CdpMessage[] = [];
  const waiters = new Map<
    number,
    { resolve: (message: CdpMessage) => void; reject: (error: Error) => void }
  >();
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as CdpMessage;
    messages.push(message);
    if (message.id === undefined) return;
    const waiter = waiters.get(message.id);
    if (!waiter) return;
    waiters.delete(message.id);
    waiter.resolve(message);
  });
  socket.on("close", () => {
    for (const waiter of waiters.values()) {
      waiter.reject(new Error("socket closed"));
    }
    waiters.clear();
  });

  let nextId = 0;
  return {
    socket,
    messages,
    command: (method, params, sessionId) => {
      const id = ++nextId;
      const response = new Promise<CdpMessage>((resolve, reject) => {
        waiters.set(id, { resolve, reject });
      });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
      return response;
    },
  };
}

describe("PreviewCdpBroker", () => {
  let broker: PreviewCdpBroker;
  let targetDebugger: FakeDebugger;

  beforeEach(async () => {
    targetDebugger = new FakeDebugger();
    broker = new PreviewCdpBroker();
    await broker.start();
    await broker.setTarget(fakeContents(targetDebugger));
  });

  afterEach(async () => {
    await broker.close();
  });

  it("requires authentication for discovery and websocket attachment", async () => {
    const { endpoint } = broker.connectionInfo;
    expect((await fetch(`${endpoint}/json/version/`)).status).toBe(401);

    const { socket } = await connect(broker);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it("closes the endpoint if the selected debugger detaches", async () => {
    const { endpoint, token } = broker.connectionInfo;
    targetDebugger.detach();

    await expect
      .poll(async () => {
        try {
          return (
            await fetch(`${endpoint}/json/version/`, {
              headers: { Authorization: `Bearer ${token}` },
            })
          ).status;
        } catch {
          return "closed";
        }
      })
      .toBe("closed");
  });

  it("stays open while intentionally handing off to a replacement target", async () => {
    const { endpoint, token } = broker.connectionInfo;
    const previousDebugger = targetDebugger;

    broker.releaseTarget();
    expect(previousDebugger.attached).toBe(false);
    expect(
      await fetch(`${endpoint}/json/version/`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ).toMatchObject({ status: 503 });

    const replacementDebugger = new FakeDebugger();
    await broker.setTarget(fakeContents(replacementDebugger));

    expect(replacementDebugger.attached).toBe(true);
    expect(
      await fetch(`${endpoint}/json/version/`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ).toMatchObject({ status: 200 });
  });

  it("presents one synthetic page and routes its page-scoped commands", async () => {
    const { socket, messages, command } = await connect(broker);

    const attach = await command("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
    expect(attach.result).toEqual({});
    await expect
      .poll(() =>
        messages.find(
          (message) => message.method === "Target.attachedToTarget",
        ),
      )
      .toMatchObject({
        params: {
          sessionId: "dyad-preview-page",
          targetInfo: {
            targetId: "real-preview-target",
            browserContextId: "dyad-preview-context",
            type: "page",
          },
        },
      });

    const evaluation = await command(
      "Runtime.evaluate",
      { expression: "6 * 7" },
      "dyad-preview-page",
    );
    expect(evaluation.result).toEqual({
      result: { type: "number", value: 42 },
    });
    expect(targetDebugger.commands.at(-1)).toEqual({
      method: "Runtime.evaluate",
      params: { expression: "6 * 7" },
      sessionId: undefined,
    });
    socket.close();
  });

  it.each([
    "Target.getTargets",
    "Target.createTarget",
    "Target.attachToTarget",
    "Target.createBrowserContext",
    "Browser.close",
    "SystemInfo.getInfo",
    "Tracing.start",
  ])("rejects process-global command %s", async (method) => {
    const { socket, command } = await connect(broker);
    const before = targetDebugger.commands.length;
    const response = await command(method, { targetId: "privileged-renderer" });
    expect(response.error?.message).toMatch(/not available|selected preview/);
    expect(targetDebugger.commands).toHaveLength(before);
    socket.close();
  });

  it("translates cookie access onto the selected preview target", async () => {
    const { socket, command } = await connect(broker);
    const response = await command("Storage.getCookies", {
      browserContextId: "attacker-selected-context",
    });
    expect(response.result).toEqual({ cookies: [] });
    expect(targetDebugger.commands.at(-1)).toEqual({
      method: "Network.getAllCookies",
      params: undefined,
      sessionId: undefined,
    });
    socket.close();
  });

  it("does not forward Playwright's browser-global download setup", async () => {
    const { socket, command } = await connect(broker);
    const before = targetDebugger.commands.length;
    expect(
      await command("Browser.setDownloadBehavior", {
        behavior: "allowAndName",
        browserContextId: "dyad-preview-context",
      }),
    ).toMatchObject({ result: {} });
    expect(targetDebugger.commands).toHaveLength(before);
    socket.close();
  });

  it("rejects cross-target commands from the page session", async () => {
    const { socket, command } = await connect(broker);
    const before = targetDebugger.commands.length;
    const response = await command(
      "Target.attachToTarget",
      { targetId: "privileged-renderer", flatten: true },
      "dyad-preview-page",
    );
    expect(response.error?.message).toMatch(/Cross-target/);
    expect(targetDebugger.commands).toHaveLength(before);
    socket.close();
  });

  it.each(["Storage.getCookies", "Tracing.start", "Memory.getDOMCounters"])(
    "rejects browser-global page-session command %s",
    async (method) => {
      const { socket, command } = await connect(broker);
      const before = targetDebugger.commands.length;
      const response = await command(method, {}, "dyad-preview-page");
      expect(response.error?.message).toMatch(/Browser-global/);
      expect(targetDebugger.commands).toHaveLength(before);
      socket.close();
    },
  );

  it("replaces real child target and session identifiers", async () => {
    const { socket, messages, command } = await connect(broker);
    await command("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
    targetDebugger.emit(
      "message",
      {},
      "Target.attachedToTarget",
      {
        sessionId: "real-worker-session",
        targetInfo: {
          targetId: "real-worker-target",
          type: "worker",
          title: "",
          url: "http://localhost:32100/worker.js",
          attached: true,
          browserContextId: "real-preview-context",
        },
        waitingForDebugger: false,
      },
      "",
    );

    await expect
      .poll(() =>
        [...messages]
          .reverse()
          .find((message) => message.method === "Target.attachedToTarget"),
      )
      .toSatisfy((message: CdpMessage | undefined) => {
        const serialized = JSON.stringify(message);
        return (
          !!message &&
          !serialized.includes("real-worker-session") &&
          !serialized.includes("real-worker-target") &&
          !serialized.includes("real-preview-context")
        );
      });
    socket.close();
  });
});
