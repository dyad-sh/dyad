// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendTelemetryEvent } from "./telemetry";
import { classifyFsPath, reportFsFailure } from "./fs_failure_telemetry";

vi.mock("./telemetry", () => ({ sendTelemetryEvent: vi.fn() }));

let appsDir: string;

vi.mock("@/paths/paths", () => ({
  getDyadAppsBaseDirectory: () => appsDir,
  getUserDataPath: () => path.join(appsDir, "..", "user-data"),
}));

describe("classifyFsPath", () => {
  const windowsRoots = {
    apps: "C:\\Users\\Ann\\dyad-apps",
    userData: "C:\\Users\\Ann\\AppData\\Roaming\\dyad",
    temp: "C:\\Users\\Ann\\AppData\\Local\\Temp",
    home: "C:\\Users\\Ann",
  };

  it.each([
    [
      "C:\\USERS\\ann\\dyad-apps\\my-app\\.gitignore",
      { location: "app", inOneDrive: false, fileCategory: "gitignore" },
    ],
    [
      "C:\\Users\\Ann\\dyad-apps\\my-app\\node_modules\\vite\\dist\\index.js",
      { location: "app", inOneDrive: false, fileCategory: "node_modules" },
    ],
    [
      "\\\\?\\C:\\Users\\Ann\\dyad-apps\\my-app\\.next\\cache\\x",
      { location: "app", inOneDrive: false, fileCategory: "build_output" },
    ],
    [
      "C:\\Users\\Ann\\dyad-apps\\my-app\\.git\\index.lock",
      { location: "app", inOneDrive: false, fileCategory: "git" },
    ],
    [
      "C:\\Users\\Ann\\AppData\\Roaming\\dyad\\sqlite.db",
      { location: "user_data", inOneDrive: false, fileCategory: "other" },
    ],
    [
      "C:\\Users\\Ann\\AppData\\Local\\Temp\\dyad-123\\package.json",
      { location: "temp", inOneDrive: false, fileCategory: "package_json" },
    ],
    [
      "C:\\Program Files (x86)\\Dyad\\resources\\pnpm\\pnpm-lock.yaml",
      {
        location: "program_files",
        inOneDrive: false,
        fileCategory: "lockfile",
      },
    ],
    [
      "C:\\Users\\Ann\\OneDrive - Contoso\\Projects\\app\\src\\App.tsx",
      { location: "home", inOneDrive: true, fileCategory: "source" },
    ],
    [
      "D:\\work\\app\\.env.local",
      { location: "other", inOneDrive: false, fileCategory: "env_file" },
    ],
  ])("classifies %s", (filePath, expected) => {
    expect(classifyFsPath(filePath, windowsRoots)).toEqual(expected);
  });

  it("finds the app folder inside OneDrive", () => {
    expect(
      classifyFsPath("C:\\Users\\Ann\\OneDrive\\dyad-apps\\a\\index.html", {
        ...windowsRoots,
        apps: "C:\\Users\\Ann\\OneDrive\\dyad-apps",
      }),
    ).toEqual({ location: "app", inOneDrive: true, fileCategory: "source" });
  });

  it("matches POSIX paths case-sensitively and by whole folder", () => {
    const roots = { apps: "/home/ann/dyad-apps", home: "/home/ann" };
    expect(
      classifyFsPath("/home/ann/dyad-apps/a/package-lock.json", roots),
    ).toEqual({ location: "app", inOneDrive: false, fileCategory: "lockfile" });
    expect(
      classifyFsPath("/home/ann/dyad-apps-old/a/README", roots).location,
    ).toBe("home");
    expect(classifyFsPath("/home/ann/Dyad-Apps/a/x.ts", roots).location).toBe(
      "home",
    );
  });

  it("recognizes OneDrive on macOS", () => {
    expect(
      classifyFsPath(
        "/Users/ann/Library/CloudStorage/OneDrive-Contoso/app/x.ts",
        { home: "/Users/ann" },
      ).inOneDrive,
    ).toBe(true);
  });
});

describe("reportFsFailure", () => {
  beforeEach(async () => {
    appsDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-failure-"));
    vi.mocked(sendTelemetryEvent).mockClear();
  });

  afterEach(async () => {
    await fs.rm(appsDir, { recursive: true, force: true });
  });

  async function realFsError(): Promise<unknown> {
    return fs
      .readFile(path.join(appsDir, "my-app", ".gitignore"))
      .catch((error: unknown) => error);
  }

  it("sends the code, call and path category of a filesystem error", async () => {
    reportFsFailure("apply_edits", await realFsError());

    expect(sendTelemetryEvent).toHaveBeenCalledWith("fs:operation-failed", {
      flow: "apply_edits",
      code: "ENOENT",
      syscall: "open",
      location: "app",
      in_onedrive: false,
      file_category: "gitignore",
    });
    const sent = JSON.stringify(vi.mocked(sendTelemetryEvent).mock.calls);
    expect(sent).not.toContain(appsDir);
  });

  it("finds a filesystem error in the cause chain", async () => {
    const wrapped = new Error("failed to delete app files", {
      cause: await realFsError(),
    });

    reportFsFailure("app_delete", wrapped);

    expect(sendTelemetryEvent).toHaveBeenCalledWith(
      "fs:operation-failed",
      expect.objectContaining({ flow: "app_delete", code: "ENOENT" }),
    );
  });

  it("reports the UNKNOWN code Windows gives for unmapped errors", () => {
    const error = Object.assign(new Error("UNKNOWN: unknown error, read"), {
      code: "UNKNOWN",
      syscall: "read",
      path: path.join(appsDir, "my-app", "src", "App.tsx"),
    });

    reportFsFailure("agent_tool", error);

    expect(sendTelemetryEvent).toHaveBeenCalledWith(
      "fs:operation-failed",
      expect.objectContaining({ code: "UNKNOWN", location: "app" }),
    );
  });

  it("counts an app outside the apps folder as an app", async () => {
    const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), "imported-app-"));
    try {
      const error = await fs
        .readFile(path.join(elsewhere, "src", "App.tsx"))
        .catch((e: unknown) => e);

      reportFsFailure("chat_stream", error);
      reportFsFailure("chat_stream", error, { appPath: elsewhere });

      const locations = vi
        .mocked(sendTelemetryEvent)
        .mock.calls.map(([, props]) => props?.location);
      expect(locations).toEqual(["temp", "app"]);
    } finally {
      await fs.rm(elsewhere, { recursive: true, force: true });
    }
  });

  it("includes the agent tool name when given", async () => {
    reportFsFailure("agent_tool", await realFsError(), { tool: "write_file" });

    expect(sendTelemetryEvent).toHaveBeenCalledWith(
      "fs:operation-failed",
      expect.objectContaining({ flow: "agent_tool", tool: "write_file" }),
    );
  });

  it.each([
    ["a plain error", new Error("model refused")],
    [
      "a network error",
      Object.assign(new Error("socket hang up"), {
        code: "ECONNRESET",
        syscall: "read",
      }),
    ],
    [
      "a failed spawn",
      Object.assign(new Error("spawn pnpm ENOENT"), {
        code: "ENOENT",
        syscall: "spawn pnpm",
        path: "pnpm",
      }),
    ],
    ["a string", "EPERM"],
    ["undefined", undefined],
  ])("ignores %s", (_label, error) => {
    reportFsFailure("chat_stream", error);

    expect(sendTelemetryEvent).not.toHaveBeenCalled();
  });
});
