/**
 * Reusable `electron` module mock for main-process integration tests that run
 * under vitest WITHOUT launching Electron.
 *
 * The chat-flow harness (and any other main-process integration suite) mocks
 * the `electron` module so that:
 *   - `ipcMain.handle` records handlers into a Map the test can invoke directly
 *     (this is how we call `chat:stream` without a renderer);
 *   - `app.getPath("userData")` resolves to the per-test temp dir chosen by the
 *     harness via the `DYAD_DEV_USER_DATA_DIR` env var (read at call time so the
 *     harness can set it after this mock is constructed);
 *   - `BrowserWindow` / `safeStorage` / `Notification` / `shell` / `dialog` /
 *     `net` / `utilityProcess` are inert stand-ins so importing main-process
 *     code does not crash.
 *
 * Usage (must be hoisted so the vi.mock factory can see the shared Map):
 *
 *   const h = vi.hoisted(() => {
 *     process.env.NODE_ENV = "development";
 *     return { ipcHandlers: new Map() };
 *   });
 *   vi.mock("electron", async () => {
 *     const { createElectronMock } = await import("@/testing/electron_mock");
 *     return createElectronMock(h);
 *   });
 *
 * The `h` object is then passed to `setupChatFlowHarness({ ipcHandlers: h.ipcHandlers })`.
 */
import { vi } from "vitest";

export type IpcHandler = (
  event: unknown,
  input: unknown,
) => unknown | Promise<unknown>;

export interface ElectronMockShared {
  /** Channel -> handler, populated by `ipcMain.handle`. */
  ipcHandlers: Map<string, IpcHandler>;
  /** Channel -> listeners, populated by `ipcMain.on`. */
  ipcListeners?: Map<string, Array<(...args: unknown[]) => void>>;
}

/**
 * Renderer stream events captured from a fake `event.sender.send(...)`.
 */
export interface RendererEvent {
  channel: string;
  payload: unknown;
}

/**
 * Builds a fake IPC `event` whose `sender.send` pushes into `sink`. This is the
 * object passed as the first argument to an ipcMain handler.
 */
export function createFakeIpcEvent(sink: RendererEvent[]): {
  sender: {
    mainFrame: { url: string };
    isDestroyed: () => boolean;
    isCrashed: () => boolean;
    send: (channel: string, payload: unknown) => void;
  };
  senderFrame: { url: string };
} {
  const frame = { url: "http://localhost:5173/" };
  return {
    sender: {
      mainFrame: frame,
      isDestroyed: () => false,
      isCrashed: () => false,
      send: (channel: string, payload: unknown) => {
        sink.push({ channel, payload });
      },
    },
    senderFrame: frame,
  };
}

function resolveUserDataPath(): string {
  return (
    process.env.DYAD_DEV_USER_DATA_DIR ||
    process.env.DYAD_TEST_USER_DATA_DIR ||
    `${process.env.TMPDIR || "/tmp"}/dyad-vitest-userdata-${process.pid}`
  );
}

/**
 * Returns an object shaped like the `electron` module. Pass the same hoisted
 * `shared` object you handed to `setupChatFlowHarness` so the recorded handlers
 * line up.
 */
export function createElectronMock(shared: ElectronMockShared) {
  const ipcListeners =
    shared.ipcListeners ??
    (shared.ipcListeners = new Map<
      string,
      Array<(...args: unknown[]) => void>
    >());

  return {
    app: {
      on: vi.fn(),
      once: vi.fn(),
      whenReady: vi.fn(() => Promise.resolve()),
      // Read at call time so the harness can set the temp dir after this mock
      // is created. All path names collapse to the per-test userData dir, which
      // matches the proven spike behavior.
      getPath: vi.fn((_name?: string) => resolveUserDataPath()),
      getAppPath: vi.fn(() => process.cwd()),
      getName: vi.fn(() => "dyad"),
      getVersion: vi.fn(() => "0.0.0-test"),
      isPackaged: false,
      quit: vi.fn(),
      exit: vi.fn(),
    },
    ipcMain: {
      // Match real Electron: registering a second handler for a channel is a
      // hard error, not a silent overwrite. Harness dispose() clears the map
      // (the moral equivalent of the Electron process exiting), so sequential
      // harnesses in one process still work.
      handle: vi.fn((channel: string, fn: IpcHandler) => {
        if (shared.ipcHandlers.has(channel)) {
          throw new Error(
            `Attempted to register a second handler for '${channel}'`,
          );
        }
        shared.ipcHandlers.set(channel, fn);
      }),
      handleOnce: vi.fn((channel: string, fn: IpcHandler) => {
        if (shared.ipcHandlers.has(channel)) {
          throw new Error(
            `Attempted to register a second handler for '${channel}'`,
          );
        }
        // Real handleOnce deregisters after the first invocation.
        shared.ipcHandlers.set(channel, (event, input) => {
          shared.ipcHandlers.delete(channel);
          return fn(event, input);
        });
      }),
      removeHandler: vi.fn((channel: string) => {
        shared.ipcHandlers.delete(channel);
      }),
      on: vi.fn((channel: string, fn: (...args: unknown[]) => void) => {
        const list = ipcListeners.get(channel) ?? [];
        list.push(fn);
        ipcListeners.set(channel, list);
      }),
      removeAllListeners: vi.fn((channel?: string) => {
        if (channel) {
          ipcListeners.delete(channel);
        } else {
          ipcListeners.clear();
        }
      }),
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => []),
      // Return the caller's own webContents so sends keep flowing to the
      // bridge sink — a stub `send` here would silently swallow messages
      // (e.g. main/settings.ts drains queued error toasts through this path).
      fromWebContents: vi.fn((webContents: { send?: unknown }) => ({
        isDestroyed: () => false,
        webContents,
      })),
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => false),
      encryptString: vi.fn((s: string) => Buffer.from(s)),
      decryptString: vi.fn((b: Buffer) => b.toString()),
    },
    Notification: vi.fn(),
    shell: {
      openExternal: vi.fn(() => Promise.resolve()),
      openPath: vi.fn(() => Promise.resolve("")),
      showItemInFolder: vi.fn(),
    },
    dialog: {
      showOpenDialog: vi.fn(() =>
        Promise.resolve({ canceled: true, filePaths: [] }),
      ),
      showSaveDialog: vi.fn(() => Promise.resolve({ canceled: true })),
      showMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
    },
    net: {},
    utilityProcess: {
      fork: vi.fn(() => ({
        on: vi.fn(),
        postMessage: vi.fn(),
        kill: vi.fn(),
      })),
    },
  };
}
