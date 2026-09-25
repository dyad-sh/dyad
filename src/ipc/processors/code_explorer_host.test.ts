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

const { isDockerRuntimeActiveMock } = vi.hoisted(() => ({
  isDockerRuntimeActiveMock: vi.fn(() => false),
}));

vi.mock("@/ipc/services/docker_runtime/runtime_mode", () => ({
  isDockerRuntimeActive: isDockerRuntimeActiveMock,
}));

vi.mock("@/ipc/utils/telemetry", () => ({
  sendTelemetryEvent: (...args: unknown[]) => sendTelemetryEventMock(...args),
}));

import {
  getCodeExplorerAvailability,
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

function writeTypeScriptTarget(rootPath: string, version: string): string {
  const targetPath = path.join(rootPath, `typescript-${version}`);
  fs.mkdirSync(path.join(targetPath, "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, "package.json"),
    JSON.stringify({ name: "typescript", version }),
  );
  fs.writeFileSync(
    path.join(targetPath, "lib", "typescript.js"),
    `module.exports = { version: ${JSON.stringify(version)} };\n`,
  );
  return targetPath;
}

function linkTypeScript(targetPath: string, linkPath: string): void {
  fs.symlinkSync(
    process.platform === "win32" ? path.resolve(targetPath) : targetPath,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
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

  it("changes when pnpm replaces the TypeScript symlink", () => {
    const appPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "code-explorer-symlink-"),
    );
    tempDirs.push(appPath);
    const nodeModulesPath = path.join(appPath, "node_modules");
    fs.mkdirSync(nodeModulesPath);
    const typeScript5Path = writeTypeScriptTarget(appPath, "5.9.3");
    const typeScript7Path = writeTypeScriptTarget(appPath, "7.0.2");
    const typeScriptLinkPath = path.join(nodeModulesPath, "typescript");
    linkTypeScript(typeScript5Path, typeScriptLinkPath);

    const before = getTypeScriptInstallationFingerprint(appPath);
    fs.rmSync(typeScriptLinkPath, { recursive: true });
    linkTypeScript(typeScript7Path, typeScriptLinkPath);

    const after = getTypeScriptInstallationFingerprint(appPath);
    expect(after).not.toBe(before);
    expect(JSON.parse(after)).toMatchObject({ packageVersion: "7.0.2" });
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

describe("code explorer compiler policy", () => {
  let child: FakeUtilityProcess;

  beforeEach(() => {
    vi.clearAllMocks();
    child = Object.assign(new EventEmitter(), {
      postMessage: vi.fn(),
      kill: vi.fn(() => true),
    });
    forkMock.mockReturnValue(child);
  });

  afterEach(() => {
    isDockerRuntimeActiveMock.mockReturnValue(false);
  });

  async function postedInput(appPath: string, { exit = true } = {}) {
    const forkCount = forkMock.mock.calls.length;
    const request = runCodeExplorer({ appPath, query: "entry point" });
    await vi.waitFor(() =>
      expect(forkMock).toHaveBeenCalledTimes(forkCount + 1),
    );
    child.emit("spawn");
    await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledOnce());
    const message = child.postMessage.mock.calls[0][0];
    child.emit("message", {
      requestId: message.requestId,
      success: true,
      data: { notes: [] },
    });
    await request;
    if (exit) {
      child.emit("exit", 0);
    }
    return message.input;
  }

  it("lets Local mode load the app's compiler", async () => {
    await expect(postedInput("/tmp/local-mode-app")).resolves.toMatchObject({
      compilerPolicy: "local-or-bundled",
      tsBuildInfoCacheDir: "/tmp/code-explorer-test-cache",
    });
  });

  it("restricts Docker mode to the bundled compiler with separate incremental state", async () => {
    isDockerRuntimeActiveMock.mockReturnValue(true);

    await expect(postedInput("/tmp/docker-mode-app")).resolves.toMatchObject({
      compilerPolicy: "bundled-only",
      tsBuildInfoCacheDir: path.join(
        "/tmp/code-explorer-test-cache",
        "bundled-only",
      ),
    });
  });

  it("replaces a host that served Local mode before serving Docker mode", async () => {
    const localChild = child;
    localChild.kill.mockImplementation(() => {
      queueMicrotask(() => localChild.emit("exit", 0));
      return true;
    });
    await postedInput("/tmp/policy-switch-app", { exit: false });

    const dockerChild: FakeUtilityProcess = Object.assign(new EventEmitter(), {
      postMessage: vi.fn(),
      kill: vi.fn(() => true),
    });
    child = dockerChild;
    forkMock.mockReturnValue(dockerChild);
    isDockerRuntimeActiveMock.mockReturnValue(true);

    // A different app: its own install fingerprint has not changed, so only
    // the policy switch can recycle the host.
    const input = await postedInput("/tmp/policy-switch-other-app");
    expect(localChild.kill).toHaveBeenCalledOnce();
    expect(localChild.postMessage).toHaveBeenCalledOnce();
    expect(forkMock).toHaveBeenCalledTimes(2);
    expect(input).toMatchObject({ compilerPolicy: "bundled-only" });
  });

  it("does not require a host TypeScript install in Docker mode", () => {
    const appPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "code-explorer-docker-availability-"),
    );
    tempDirs.push(appPath);
    fs.writeFileSync(path.join(appPath, "tsconfig.json"), "{}");

    expect(getCodeExplorerAvailability(appPath)).toMatchObject({
      ready: false,
      reason: "typescript_not_installed",
    });

    isDockerRuntimeActiveMock.mockReturnValue(true);
    expect(getCodeExplorerAvailability(appPath)).toEqual({
      ready: true,
      reason: null,
      tsconfigPath: "tsconfig.json",
    });
  });
});
