import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  expandWindowsEnvVars,
  mergeWindowsPathSegments,
  parseRegQueryPathOutput,
  readRefreshedWindowsPath,
  resetWindowsEnvPathReaderStateForTests,
} from "./windows_env_path";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  default: { spawn: spawnMock },
  spawn: spawnMock,
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      warn: vi.fn(),
    }),
  },
}));

function spawnSuccess(stdout: string) {
  return spawnResult({ stdout, status: 0 });
}

function spawnFailure() {
  return spawnResult({ stdout: "", status: 1 });
}

function spawnTimeout() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter() as EventEmitter & {
    setEncoding: ReturnType<typeof vi.fn>;
  };
  child.stdout.setEncoding = vi.fn();
  child.kill = vi.fn(() => true);
  return child;
}

function spawnResult({ stdout, status }: { stdout: string; status: number }) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter() as EventEmitter & {
    setEncoding: ReturnType<typeof vi.fn>;
  };
  child.stdout.setEncoding = vi.fn();
  child.kill = vi.fn(() => {
    queueMicrotask(() => {
      child.emit("close", null);
    });
    return true;
  });
  queueMicrotask(() => {
    if (stdout) {
      child.stdout.emit("data", stdout);
    }
    child.emit("close", status);
  });
  return child;
}

beforeEach(() => {
  spawnMock.mockReset();
  resetWindowsEnvPathReaderStateForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseRegQueryPathOutput", () => {
  it("parses a REG_EXPAND_SZ Path value", () => {
    const output = [
      "",
      "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
      "    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;%SystemRoot%;C:\\Program Files\\nodejs\\",
      "",
    ].join("\r\n");

    expect(parseRegQueryPathOutput(output)).toBe(
      "%SystemRoot%\\system32;%SystemRoot%;C:\\Program Files\\nodejs\\",
    );
  });

  it("parses a REG_SZ Path value", () => {
    const output = [
      "HKEY_CURRENT_USER\\Environment",
      "    Path    REG_SZ    C:\\Users\\john\\AppData\\Roaming\\npm",
    ].join("\r\n");

    expect(parseRegQueryPathOutput(output)).toBe(
      "C:\\Users\\john\\AppData\\Roaming\\npm",
    );
  });

  it("returns null for missing value or empty output", () => {
    expect(parseRegQueryPathOutput(null)).toBeNull();
    expect(parseRegQueryPathOutput("")).toBeNull();
    expect(
      parseRegQueryPathOutput(
        "ERROR: The system was unable to find the specified registry key or value.",
      ),
    ).toBeNull();
  });
});

describe("expandWindowsEnvVars", () => {
  it("expands known variables case-insensitively", () => {
    expect(
      expandWindowsEnvVars("%SystemRoot%\\system32;%SYSTEMROOT%", {
        SystemRoot: "C:\\Windows",
      }),
    ).toBe("C:\\Windows\\system32;C:\\Windows");
  });

  it("leaves unknown variables untouched", () => {
    expect(expandWindowsEnvVars("%NOT_A_REAL_VAR%\\bin", {})).toBe(
      "%NOT_A_REAL_VAR%\\bin",
    );
  });
});

describe("mergeWindowsPathSegments", () => {
  it("appends new registry entries after current entries", () => {
    expect(
      mergeWindowsPathSegments(
        "C:\\dyad\\managed;C:\\Windows\\system32",
        "C:\\Windows\\system32;C:\\Program Files\\nodejs",
      ),
    ).toBe("C:\\dyad\\managed;C:\\Windows\\system32;C:\\Program Files\\nodejs");
  });

  it("dedupes case-insensitively and ignores trailing slashes", () => {
    expect(
      mergeWindowsPathSegments(
        "C:\\Program Files\\nodejs\\",
        "c:\\program files\\nodejs",
      ),
    ).toBe("C:\\Program Files\\nodejs\\");
  });

  it("drops empty segments", () => {
    expect(mergeWindowsPathSegments("C:\\a;;", ";C:\\b;")).toBe("C:\\a;C:\\b");
  });

  it("keeps session-only entries that are not in the registry", () => {
    expect(
      mergeWindowsPathSegments(
        "C:\\Users\\john\\AppData\\Roaming\\fnm\\node-versions\\v22.0.0\\installation",
        "C:\\Windows\\system32",
      ),
    ).toBe(
      "C:\\Users\\john\\AppData\\Roaming\\fnm\\node-versions\\v22.0.0\\installation;C:\\Windows\\system32",
    );
  });

  it("uses registry ordering for registry-known entries", () => {
    expect(
      mergeWindowsPathSegments(
        "C:\\session-only;C:\\Users\\john\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Windows\\system32",
        "C:\\Windows\\system32;C:\\Program Files\\nodejs;C:\\Users\\john\\AppData\\Local\\Microsoft\\WindowsApps",
      ),
    ).toBe(
      "C:\\session-only;C:\\Windows\\system32;C:\\Program Files\\nodejs;C:\\Users\\john\\AppData\\Local\\Microsoft\\WindowsApps",
    );
  });
});

describe("readRefreshedWindowsPath", () => {
  it("uses the PowerShell PATH when available", async () => {
    spawnMock.mockImplementation(() =>
      spawnSuccess("C:\\Windows\\system32;C:\\Program Files\\nodejs\r\n"),
    );

    await expect(readRefreshedWindowsPath("C:\\session-only")).resolves.toBe(
      "C:\\session-only;C:\\Windows\\system32;C:\\Program Files\\nodejs",
    );
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to reg.exe when PowerShell fails", async () => {
    spawnMock
      .mockImplementationOnce(() => spawnFailure())
      .mockImplementationOnce(() =>
        spawnSuccess(
          [
            "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
            "    Path    REG_SZ    C:\\Windows\\system32;C:\\Program Files\\nodejs",
          ].join("\r\n"),
        ),
      )
      .mockImplementationOnce(() =>
        spawnSuccess(
          [
            "HKEY_CURRENT_USER\\Environment",
            "    Path    REG_SZ    C:\\Users\\john\\AppData\\Roaming\\npm",
          ].join("\r\n"),
        ),
      );

    await expect(readRefreshedWindowsPath("C:\\session-only")).resolves.toBe(
      "C:\\session-only;C:\\Windows\\system32;C:\\Program Files\\nodejs;C:\\Users\\john\\AppData\\Roaming\\npm",
    );
    expect(spawnMock).toHaveBeenCalledTimes(3);
  });

  it("skips PowerShell after a failed PowerShell read", async () => {
    spawnMock
      .mockImplementationOnce(() => spawnFailure())
      .mockImplementationOnce(() =>
        spawnSuccess(
          [
            "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
            "    Path    REG_SZ    C:\\Windows\\system32",
          ].join("\r\n"),
        ),
      )
      .mockImplementationOnce(() => spawnFailure())
      .mockImplementationOnce(() =>
        spawnSuccess(
          [
            "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
            "    Path    REG_SZ    C:\\Windows\\system32;C:\\Program Files\\nodejs",
          ].join("\r\n"),
        ),
      )
      .mockImplementationOnce(() => spawnFailure());

    await expect(readRefreshedWindowsPath("C:\\session-only")).resolves.toBe(
      "C:\\session-only;C:\\Windows\\system32",
    );
    await expect(readRefreshedWindowsPath("C:\\session-only")).resolves.toBe(
      "C:\\session-only;C:\\Windows\\system32;C:\\Program Files\\nodejs",
    );

    expect(spawnMock).toHaveBeenCalledTimes(5);
    expect(spawnMock.mock.calls[0][0]).toContain("powershell.exe");
    expect(spawnMock.mock.calls[3][0]).toContain("reg.exe");
  });

  it("falls back to reg.exe when PowerShell times out without closing", async () => {
    vi.useFakeTimers();
    spawnMock
      .mockImplementationOnce(() => spawnTimeout())
      .mockImplementationOnce(() =>
        spawnSuccess(
          [
            "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
            "    Path    REG_SZ    C:\\Windows\\system32;C:\\Program Files\\nodejs",
          ].join("\r\n"),
        ),
      )
      .mockImplementationOnce(() => spawnFailure());

    const refreshedPathPromise = readRefreshedWindowsPath("C:\\session-only");
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(refreshedPathPromise).resolves.toBe(
      "C:\\session-only;C:\\Windows\\system32;C:\\Program Files\\nodejs",
    );
    expect(spawnMock).toHaveBeenCalledTimes(3);
    expect(spawnMock.mock.results[0].value.kill).toHaveBeenCalled();
  });

  it("falls back to reg.exe when PowerShell returns only separators", async () => {
    spawnMock
      .mockImplementationOnce(() => spawnSuccess(";\r\n"))
      .mockImplementationOnce(() =>
        spawnSuccess(
          [
            "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
            "    Path    REG_SZ    C:\\Windows\\system32",
          ].join("\r\n"),
        ),
      )
      .mockImplementationOnce(() => spawnFailure());

    await expect(readRefreshedWindowsPath("C:\\session-only")).resolves.toBe(
      "C:\\session-only;C:\\Windows\\system32",
    );
  });

  it("returns null when both registry readers fail", async () => {
    spawnMock.mockImplementation(() => spawnFailure());

    await expect(
      readRefreshedWindowsPath("C:\\session-only"),
    ).resolves.toBeNull();
  });
});
