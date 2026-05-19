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

function createMockPtyController(pid: number): MockPtyController {
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
      pid,
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

function webContents(id: number) {
  return {
    id,
    isDestroyed: () => false,
  } as WebContents;
}

function createManager() {
  let now = 1;
  const controllers: MockPtyController[] = [];
  const send = vi.fn();
  const spawner = vi.fn((_shell, _args, _options) => {
    const controller = createMockPtyController(controllers.length + 1);
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
      { sessionId: session.sessionId, chunk: "ab" },
    );
    expect(manager.serialize(session.sessionId)).toBe("ab");
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
