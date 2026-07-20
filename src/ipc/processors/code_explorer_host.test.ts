import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { forkMock, sendTelemetryEventMock } = vi.hoisted(() => ({
  forkMock: vi.fn(),
  sendTelemetryEventMock: vi.fn(),
}));

vi.mock("electron", () => ({
  utilityProcess: {
    fork: (...args: unknown[]) => forkMock(...args),
  },
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("@/paths/paths", () => ({
  getTypeScriptCachePath: () => "/tmp/code-explorer-test-cache",
}));

vi.mock("@/ipc/utils/telemetry", () => ({
  sendTelemetryEvent: (...args: unknown[]) => sendTelemetryEventMock(...args),
}));

import {
  getTypeScriptInstallationFingerprint,
  runCodeExplorer,
} from "./code_explorer";

interface FakeUtilityProcess extends EventEmitter {
  postMessage: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
}

const tempDirs: string[] = [];

function createTypeScriptInstallation(version: string): string {
  const appPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "code-explorer-fingerprint-"),
  );
  tempDirs.push(appPath);
  const typeScriptPath = path.join(appPath, "node_modules", "typescript");
  fs.mkdirSync(path.join(typeScriptPath, "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(typeScriptPath, "package.json"),
    JSON.stringify({
      name: "typescript",
      version,
      main: "lib/typescript.js",
    }),
  );
  fs.writeFileSync(
    path.join(typeScriptPath, "lib", "typescript.js"),
    "module.exports = {};\n",
  );
  return appPath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("TypeScript installation fingerprints", () => {
  it("stays stable across ordinary source edits", () => {
    const appPath = createTypeScriptInstallation("7.0.0");
    const before = getTypeScriptInstallationFingerprint(appPath);

    fs.mkdirSync(path.join(appPath, "src"));
    fs.writeFileSync(path.join(appPath, "src", "app.ts"), "export {};\n");

    expect(getTypeScriptInstallationFingerprint(appPath)).toBe(before);
  });

  it("changes when the installed TypeScript version changes", () => {
    const appPath = createTypeScriptInstallation("7.0.0");
    const before = getTypeScriptInstallationFingerprint(appPath);

    fs.writeFileSync(
      path.join(appPath, "node_modules", "typescript", "package.json"),
      JSON.stringify({
        name: "typescript",
        version: "6.0.3",
        main: "lib/typescript.js",
      }),
    );

    expect(getTypeScriptInstallationFingerprint(appPath)).not.toBe(before);
  });

  it("changes when the same TypeScript version is reinstalled", () => {
    const appPath = createTypeScriptInstallation("6.0.3");
    const before = getTypeScriptInstallationFingerprint(appPath);

    fs.writeFileSync(
      path.join(appPath, "node_modules", "typescript", "lib", "typescript.js"),
      "module.exports = { reinstalled: true };\n",
    );

    expect(getTypeScriptInstallationFingerprint(appPath)).not.toBe(before);
  });
});

describe("code explorer host telemetry", () => {
  let child: FakeUtilityProcess;

  beforeEach(() => {
    vi.clearAllMocks();
    child = Object.assign(new EventEmitter(), {
      postMessage: vi.fn(),
      kill: vi.fn(() => true),
    });
    forkMock.mockReturnValue(child);
  });

  it("reports a fatal V8 host crash without including the diagnostic report", async () => {
    const request = runCodeExplorer({
      appPath: "/tmp/example-app",
      query: "find the entry point",
    });

    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit("spawn");
    await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledOnce());

    child.emit(
      "error",
      "FatalError",
      "CALL_AND_RETRY_LAST",
      "sensitive diagnostic report",
    );
    child.emit("exit", 0);

    await expect(request).rejects.toThrow(
      "Code explorer host exited with code 0 before replying",
    );
    expect(child.kill).toHaveBeenCalledOnce();
    expect(sendTelemetryEventMock).toHaveBeenCalledOnce();
    expect(sendTelemetryEventMock).toHaveBeenCalledWith(
      "code_explorer:host_crash",
      {
        error: true,
        generation: 1,
        reason: "v8_fatal_error",
        exit_code: 0,
        pending_request_count: 1,
        had_active_request: true,
        crash_loop_guard_triggered: false,
        fatal_error_type: "FatalError",
        fatal_error_location: "CALL_AND_RETRY_LAST",
      },
    );
    expect(JSON.stringify(sendTelemetryEventMock.mock.calls)).not.toContain(
      "sensitive diagnostic report",
    );
  });
});
