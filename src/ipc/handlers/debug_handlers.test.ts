import { beforeEach, describe, expect, it, vi } from "vitest";
import { systemContracts } from "../types/system";
import {
  retainCapture,
  getCapture,
  discardCapture,
} from "../utils/screenshot_captures";
import { miscContracts } from "../types/misc";

const mocks = vi.hoisted(() => ({
  handlers: new Map<unknown, (event: unknown, req: unknown) => Promise<any>>(),
  readEffectiveSettings: vi.fn(),
  readSettings: vi.fn(),
  writeClipboardImage: vi.fn(),
}));

vi.mock("@/main/clipboard_image", () => ({
  writeClipboardImage: mocks.writeClipboardImage,
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/dyad-test" },
  BrowserWindow: {},
  clipboard: {},
}));
vi.mock("./base", () => ({
  createTypedHandler: (
    contract: unknown,
    handler: (event: unknown, req: unknown) => Promise<any>,
  ) => mocks.handlers.set(contract, handler),
}));
vi.mock("../../main/settings", () => ({
  readEffectiveSettings: mocks.readEffectiveSettings,
  readSettings: mocks.readSettings,
}));
vi.mock("@/ipc/utils/socket_firewall", () => ({
  getPackageManagerCommandEnv: () => ({}),
  PNPM_PM_ON_FAIL_IGNORE_ARG: "",
}));
vi.mock("../utils/runShellCommand", () => ({
  runShellCommand: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../utils/codebase", () => ({
  extractCodebase: vi.fn().mockResolvedValue({ formattedOutput: "" }),
}));
vi.mock("../../utils/crash_dump_report", () => ({
  collectCrashDumps: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../utils/process_memory_diagnostics", () => ({
  collectProcessMemoryDiagnostics: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../main/previous_session_crash", () => ({
  getPreviousSessionCrashDump: vi.fn(),
}));
vi.mock("../../main/updater_state", () => ({
  getLastUpdaterError: vi.fn(() => null),
}));
vi.mock("../../paths/paths", () => ({
  getDyadAppPath: (appPath: string) => appPath,
}));
vi.mock("../../db", () => {
  const date = new Date(0);
  return {
    db: {
      query: {
        chats: {
          findFirst: vi.fn().mockResolvedValue({
            id: 1,
            appId: 2,
            title: "chat",
            initialCommitHash: null,
            createdAt: date,
            messages: [],
            modelSelection: {
              provider: "auto",
              name: "auto",
              effortLevel: "default",
            },
          }),
        },
        apps: {
          findFirst: vi.fn().mockResolvedValue({
            id: 2,
            name: "app",
            path: "app",
            createdAt: date,
            updatedAt: date,
            chatContext: null,
          }),
        },
      },
      select: () => ({ from: () => Promise.resolve([]) }),
    },
  };
});

import { registerDebugHandlers } from "./debug_handlers";

describe("getSessionDebugBundle", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    registerDebugHandlers();
  });

  it("reports the effective settings the app runs with", async () => {
    const settings = {
      selectedModel: { provider: "auto", name: "auto" },
      providerSettings: {},
      selectedTemplateId: "react",
      enableAutoUpdate: true,
      releaseChannel: "stable",
    };
    mocks.readSettings.mockReturnValue(settings);
    mocks.readEffectiveSettings.mockResolvedValue({
      ...settings,
      blockUnsafeNpmPackages: false,
    });

    const handler = mocks.handlers.get(miscContracts.getSessionDebugBundle)!;
    const bundle = await handler({}, { chatId: 1 });

    expect(bundle.settings.blockUnsafeNpmPackages).toBe(false);
  });
});

describe("screenshot clipboard handoff", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.writeClipboardImage.mockReset();
    registerDebugHandlers();
  });
  it("retains the capture until the asynchronous clipboard write finishes", async () => {
    const id = "clipboard-pending";
    const image = {} as Electron.NativeImage;
    retainCapture(id, image);
    let finish!: () => void;
    mocks.writeClipboardImage.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const result = mocks.handlers.get(systemContracts.recopyScreenshot)!(
      {},
      { captureId: id },
    );
    expect(getCapture(id)).toBe(image);
    finish();
    await expect(result).resolves.toEqual({ copied: true });
    expect(getCapture(id)).toBeUndefined();
  });
  it("preserves the capture if clipboard access fails", async () => {
    const id = "clipboard-failed";
    const image = {} as Electron.NativeImage;
    retainCapture(id, image);
    mocks.writeClipboardImage.mockRejectedValue(new Error("clipboard denied"));
    try {
      await expect(
        mocks.handlers.get(systemContracts.recopyScreenshot)!(
          {},
          { captureId: id },
        ),
      ).resolves.toEqual({ copied: false, retained: true });
      expect(getCapture(id)).toBe(image);
    } finally {
      discardCapture(id);
    }
  });
});
