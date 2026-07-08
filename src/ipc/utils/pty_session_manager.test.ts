import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebContents } from "electron";
import {
  getDefaultShell,
  PtySessionManager,
  type TerminalPtyProcess,
  type TerminalSessionManagerDeps,
} from "./pty_session_manager";

interface MockPtyController {
  emitData(data: string): void;
  emitExit(event: { exitCode: number; signal?: number }): void;
  pty: TerminalPtyProcess & {
    kill: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
  };
}

function createMockPtyController(): MockPtyController {
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<
    (event: { exitCode: number; signal?: number }) => void
  >();

  return {
    emitData(data) {
      for (const listener of dataListeners) {
        listener(data);
      }
    },
    emitExit(event) {
      for (const listener of exitListeners) {
        listener(event);
      }
    },
    pty: {
      pid: undefined,
      kill: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      onData: vi.fn((listener: (data: string) => void) => {
        dataListeners.add(listener);
        return { dispose: () => dataListeners.delete(listener) };
      }),
      onExit: vi.fn(
        (listener: (event: { exitCode: number; signal?: number }) => void) => {
          exitListeners.add(listener);
          return { dispose: () => exitListeners.delete(listener) };
        },
      ),
    },
  };
}

function webContents(id: number, isDestroyed = () => false) {
  return {
    id,
    isDestroyed,
  } as WebContents;
}

function createManager() {
  let now = 1;
  const controllers: MockPtyController[] = [];
  const send = vi.fn();
  const spawner = vi.fn((_shell, _args, _options) => {
    const controller = createMockPtyController();
    controllers.push(controller);
    return controller.pty;
  });
  const deps: TerminalSessionManagerDeps = {
    resolveApp: async (appId) => ({
      id: appId,
      name: `App ${appId}`,
      cwd: `/tmp/app-${appId}`,
    }),
    pathExists: () => true,
    ptySpawner: spawner,
    getShellEnv: () => ({ PATH: "/usr/local/bin:/usr/bin" }),
    send,
    now: () => now,
  };

  return {
    manager: new PtySessionManager(deps),
    controllers,
    send,
    spawner,
    setNow(value: number) {
      now = value;
    },
    deps,
  };
}

describe("getDefaultShell", () => {
  it("uses COMSPEC on Windows", () => {
    expect(
      getDefaultShell("win32", { COMSPEC: "C:\\Windows\\System32\\cmd.exe" }),
    ).toEqual({
      shell: "C:\\Windows\\System32\\cmd.exe",
      args: [],
    });
  });

  it("uses SHELL with login args on Unix", () => {
    expect(getDefaultShell("darwin", { SHELL: "/bin/zsh" })).toEqual({
      shell: "/bin/zsh",
      args: ["-l"],
    });
  });
});

describe("PtySessionManager", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("spawns one PTY per app and reuses it across attachments", async () => {
    const { manager, spawner } = createManager();

    const first = await manager.openSession({
      appId: 1,
      cols: 100,
      rows: 30,
      sender: webContents(1),
    });
    const second = await manager.openSession({
      appId: 1,
      sender: webContents(2),
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.sessionId).toBe(first.sessionId);
    expect(spawner).toHaveBeenCalledTimes(1);
    expect(spawner).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        cols: 100,
        cwd: "/tmp/app-1",
        env: expect.objectContaining({
          COLORTERM: "truecolor",
          PATH: "/usr/local/bin:/usr/bin",
          TERM: "xterm-256color",
        }),
        rows: 30,
      }),
    );
  });

  it("coalesces dense output before sending it to subscribers", async () => {
    vi.useFakeTimers();
    const { manager, controllers, send } = createManager();
    const session = await manager.openSession({
      appId: 1,
      sender: webContents(1),
    });

    controllers[0].emitData("a");
    controllers[0].emitData("b");
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(8);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      `terminal:data:${session.sessionId}`,
      {
        sessionId: session.sessionId,
        chunk: "ab",
        startOffset: 0,
        endOffset: 2,
      },
    );
    expect(manager.serialize(session.sessionId)).toEqual({
      scrollback: "ab",
      scrollbackEndOffset: 2,
    });
  });

  it("does not replay pending output after serializing it", async () => {
    vi.useFakeTimers();
    const { manager, controllers, send } = createManager();
    const sender = webContents(1);
    const session = await manager.openSession({
      appId: 1,
      sender,
    });

    controllers[0].emitData("prompt");

    expect(manager.serialize(session.sessionId, sender)).toEqual({
      scrollback: "prompt",
      scrollbackEndOffset: 6,
    });
    await vi.advanceTimersByTimeAsync(8);

    expect(send).not.toHaveBeenCalled();
  });

  it("writes, resizes, and kills sessions explicitly", async () => {
    const { manager, controllers, send } = createManager();
    const session = await manager.openSession({
      appId: 1,
      sender: webContents(1),
    });

    manager.write(session.sessionId, "echo hi\n");
    manager.resize(session.sessionId, 120, 40);
    manager.killSession(session.sessionId);

    expect(controllers[0].pty.write).toHaveBeenCalledWith("echo hi\n");
    expect(controllers[0].pty.resize).toHaveBeenCalledWith(120, 40);
    expect(controllers[0].pty.kill).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      `terminal:exit:${session.sessionId}`,
      { sessionId: session.sessionId, exitCode: null, signal: null },
    );
    expect(manager.getSessionCount()).toBe(0);
  });

  it("rejects control calls from renderers that are not attached", async () => {
    const { manager, controllers } = createManager();
    const session = await manager.openSession({
      appId: 1,
      sender: webContents(1),
    });

    expect(() =>
      manager.write(session.sessionId, "echo nope\n", webContents(2)),
    ).toThrow("Terminal session is not attached to this window");
    expect(controllers[0].pty.write).not.toHaveBeenCalled();
  });

  it("allows follow-up IPC calls from the same renderer id", async () => {
    const { manager, controllers } = createManager();
    const session = await manager.openSession({
      appId: 1,
      sender: webContents(1),
    });
    controllers[0].emitData("prompt");

    const sameRenderer = webContents(1);
    expect(manager.serialize(session.sessionId, sameRenderer)).toEqual({
      scrollback: "prompt",
      scrollbackEndOffset: 6,
    });
    manager.write(session.sessionId, "echo ok\n", sameRenderer);

    expect(controllers[0].pty.write).toHaveBeenCalledWith("echo ok\n");
  });

  it("keeps a newer same-window attachment when stale open cleanup closes", async () => {
    const { manager, controllers } = createManager();
    const staleSender = webContents(1);
    const currentSender = webContents(1);
    const session = await manager.openSession({
      appId: 1,
      sender: staleSender,
    });
    controllers[0].emitData("prompt");

    await manager.openSession({
      appId: 1,
      sender: currentSender,
    });
    manager.closeSession(session.sessionId, staleSender);

    expect(manager.serialize(session.sessionId, currentSender)).toEqual({
      scrollback: "prompt",
      scrollbackEndOffset: 6,
    });
  });

  it("prunes destroyed subscribers before sending output", async () => {
    vi.useFakeTimers();
    let destroyed = false;
    const { manager, controllers, send } = createManager();
    await manager.openSession({
      appId: 1,
      sender: webContents(1, () => destroyed),
    });

    destroyed = true;
    controllers[0].emitData("lost\n");
    await vi.advanceTimersByTimeAsync(8);

    expect(send).not.toHaveBeenCalled();
  });

  it("does not send pre-attach pending output to new subscribers", async () => {
    vi.useFakeTimers();
    const { manager, controllers, send } = createManager();
    const firstSender = webContents(1);
    const secondSender = webContents(2);
    const session = await manager.openSession({
      appId: 1,
      sender: firstSender,
    });

    controllers[0].emitData("early");
    const reattach = await manager.openSession({
      appId: 1,
      sender: secondSender,
    });
    expect(manager.serialize(reattach.sessionId, secondSender)).toEqual({
      scrollback: "early",
      scrollbackEndOffset: 5,
    });

    controllers[0].emitData("late");
    await vi.advanceTimersByTimeAsync(8);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(
      1,
      firstSender,
      `terminal:data:${session.sessionId}`,
      {
        sessionId: session.sessionId,
        chunk: "earlylate",
        startOffset: 0,
        endOffset: 9,
      },
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      secondSender,
      `terminal:data:${session.sessionId}`,
      {
        sessionId: session.sessionId,
        chunk: "late",
        startOffset: 5,
        endOffset: 9,
      },
    );
  });

  it("keeps exited sessions available for scrollback and restart UI", async () => {
    const { manager, controllers, send } = createManager();
    const session = await manager.openSession({
      appId: 1,
      sender: webContents(1),
    });
    controllers[0].emitData("done\n");
    controllers[0].emitExit({ exitCode: 7 });

    const reattach = await manager.openSession({
      appId: 1,
      sender: webContents(2),
    });

    expect(reattach.created).toBe(false);
    expect(reattach.scrollback).toBe("done\n");
    expect(reattach.exited).toEqual({ exitCode: 7, signal: null });
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      `terminal:exit:${session.sessionId}`,
      { sessionId: session.sessionId, exitCode: 7, signal: null },
    );
  });

  it("reaps detached exited sessions after the retention TTL", async () => {
    vi.useFakeTimers();
    const { manager, controllers } = createManager();
    const sender = webContents(1);
    const session = await manager.openSession({
      appId: 1,
      sender,
    });

    controllers[0].emitExit({ exitCode: 0 });
    manager.closeSession(session.sessionId, sender);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(manager.getSessionCount()).toBe(0);
  });

  it("trims scrollback to the byte cap without splitting multibyte output", async () => {
    const { manager, controllers } = createManager();
    const session = await manager.openSession({
      appId: 1,
      sender: webContents(1),
    });

    controllers[0].emitData("😀".repeat(600_000));

    const { scrollback } = manager.serialize(session.sessionId);
    expect(Buffer.byteLength(scrollback, "utf8")).toBeLessThanOrEqual(
      2 * 1024 * 1024,
    );
    expect(scrollback).not.toContain("\uFFFD");
  });

  it("LRU-evicts the oldest live session when the cap is exceeded", async () => {
    const { manager, controllers, setNow } = createManager();

    for (let appId = 1; appId <= 5; appId++) {
      setNow(appId);
      await manager.openSession({ appId, sender: webContents(appId) });
    }

    setNow(6);
    const sixth = await manager.openSession({
      appId: 6,
      sender: webContents(6),
    });

    expect(sixth.evicted).toEqual({ appId: 1, appName: "App 1" });
    expect(controllers[0].pty.kill).toHaveBeenCalledTimes(1);
    expect(manager.getLiveSessionCount()).toBe(5);
  });

  it("throws a non-bug error for missing app folders", async () => {
    const { manager, deps } = createManager();
    deps.pathExists = () => false;

    await expect(manager.openSession({ appId: 1 })).rejects.toMatchObject({
      kind: "precondition",
      message: "App folder no longer exists at /tmp/app-1",
    });
  });
});
