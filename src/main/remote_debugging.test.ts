import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({
  appendSwitch: vi.fn(),
  paths: {} as Record<string, string>,
  settingsFile: "",
}));

vi.mock("electron", () => ({
  app: {
    commandLine: { appendSwitch: h.appendSwitch },
    getPath: vi.fn((name: string) => {
      const value = h.paths[name];
      if (!value) throw new Error(`No path for ${name}`);
      return value;
    }),
  },
}));

vi.mock("./settings", () => ({
  getSettingsFilePath: () => h.settingsFile,
}));

import {
  isRemoteDebuggingSwitchApplied,
  maybeEnableRemoteDebugging,
  resetRemoteDebuggingForTesting,
  resolveRemoteDebuggingEndpoint,
} from "./remote_debugging";

let tmpDir: string;

function writeSettings(contents: string) {
  fs.writeFileSync(h.settingsFile, contents);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-remote-debug-"));
  h.settingsFile = path.join(tmpDir, "user-settings.json");
  h.paths = {
    sessionData: path.join(tmpDir, "session"),
    userData: path.join(tmpDir, "user"),
  };
  fs.mkdirSync(h.paths.sessionData, { recursive: true });
  fs.mkdirSync(h.paths.userData, { recursive: true });
  h.appendSwitch.mockClear();
  resetRemoteDebuggingForTesting();
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("maybeEnableRemoteDebugging", () => {
  it("does nothing when the experiment is off", () => {
    writeSettings(JSON.stringify({ enableTestRunInPreview: false }));

    maybeEnableRemoteDebugging();

    expect(h.appendSwitch).not.toHaveBeenCalled();
    expect(isRemoteDebuggingSwitchApplied()).toBe(false);
  });

  it("does nothing when the settings file is missing or unparseable", () => {
    maybeEnableRemoteDebugging();
    expect(h.appendSwitch).not.toHaveBeenCalled();

    writeSettings("{ not json");
    maybeEnableRemoteDebugging();
    expect(h.appendSwitch).not.toHaveBeenCalled();
  });

  it("opts into a loopback debugging port when the experiment is on", () => {
    writeSettings(JSON.stringify({ enableTestRunInPreview: true }));

    maybeEnableRemoteDebugging();

    expect(h.appendSwitch).toHaveBeenCalledWith("remote-debugging-port", "0");
    expect(isRemoteDebuggingSwitchApplied()).toBe(true);
  });

  it("reads the flag without going through the settings schema", async () => {
    // Encrypted secrets can't be decrypted before the app is ready, so the
    // normal settings read would fall back to defaults and disable this.
    writeSettings(
      JSON.stringify({
        enableTestRunInPreview: true,
        githubAccessToken: {
          value: "!!not-decryptable!!",
          encryptionType: "electron-safe-storage",
        },
      }),
    );

    maybeEnableRemoteDebugging();

    expect(isRemoteDebuggingSwitchApplied()).toBe(true);
  });
});

describe("resolveRemoteDebuggingEndpoint", () => {
  function enable() {
    writeSettings(JSON.stringify({ enableTestRunInPreview: true }));
    maybeEnableRemoteDebugging();
  }

  it("returns null when the switch was never applied", async () => {
    await expect(resolveRemoteDebuggingEndpoint()).resolves.toBeNull();
  });

  it("reads the port Chromium published in the session dir", async () => {
    enable();
    fs.writeFileSync(
      path.join(h.paths.sessionData, "DevToolsActivePort"),
      "51234\n/devtools/browser/abc\n",
    );

    await expect(resolveRemoteDebuggingEndpoint()).resolves.toEqual({
      port: 51234,
      httpEndpoint: "http://127.0.0.1:51234",
    });
  });

  it("falls back to the userData dir, which dev builds re-point", async () => {
    enable();
    fs.writeFileSync(
      path.join(h.paths.userData, "DevToolsActivePort"),
      "40000\n",
    );

    await expect(resolveRemoteDebuggingEndpoint()).resolves.toEqual({
      port: 40000,
      httpEndpoint: "http://127.0.0.1:40000",
    });
  });

  it("caches the resolved endpoint", async () => {
    enable();
    const portFile = path.join(h.paths.sessionData, "DevToolsActivePort");
    fs.writeFileSync(portFile, "51234\n");

    const first = await resolveRemoteDebuggingEndpoint();
    fs.rmSync(portFile);

    await expect(resolveRemoteDebuggingEndpoint()).resolves.toEqual(first);
  });

  it("gives up when the port file never appears", async () => {
    enable();
    vi.useFakeTimers();

    const pending = resolveRemoteDebuggingEndpoint();
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(pending).resolves.toBeNull();
  });

  it("ignores a port file with junk in it", async () => {
    enable();
    fs.writeFileSync(
      path.join(h.paths.sessionData, "DevToolsActivePort"),
      "not-a-port\n",
    );
    vi.useFakeTimers();

    const pending = resolveRemoteDebuggingEndpoint();
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(pending).resolves.toBeNull();
  });
});
