import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  expandWindowsEnvVars,
  mergeWindowsPathSegments,
  parseRegQueryPathOutput,
  readRefreshedWindowsPath,
} from "./windows_env_path";

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  default: { spawnSync: spawnSyncMock },
  spawnSync: spawnSyncMock,
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      warn: vi.fn(),
    }),
  },
}));

function spawnSuccess(stdout: string) {
  return { stdout, status: 0, error: undefined };
}

function spawnFailure() {
  return { stdout: "", status: 1, error: undefined };
}

beforeEach(() => {
  spawnSyncMock.mockReset();
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
  it("uses the PowerShell PATH when available", () => {
    spawnSyncMock.mockReturnValue(
      spawnSuccess("C:\\Windows\\system32;C:\\Program Files\\nodejs\r\n"),
    );

    expect(readRefreshedWindowsPath("C:\\session-only")).toBe(
      "C:\\session-only;C:\\Windows\\system32;C:\\Program Files\\nodejs",
    );
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to reg.exe when PowerShell fails", () => {
    spawnSyncMock
      .mockReturnValueOnce(spawnFailure())
      .mockReturnValueOnce(
        spawnSuccess(
          [
            "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
            "    Path    REG_SZ    C:\\Windows\\system32;C:\\Program Files\\nodejs",
          ].join("\r\n"),
        ),
      )
      .mockReturnValueOnce(
        spawnSuccess(
          [
            "HKEY_CURRENT_USER\\Environment",
            "    Path    REG_SZ    C:\\Users\\john\\AppData\\Roaming\\npm",
          ].join("\r\n"),
        ),
      );

    expect(readRefreshedWindowsPath("C:\\session-only")).toBe(
      "C:\\session-only;C:\\Windows\\system32;C:\\Program Files\\nodejs;C:\\Users\\john\\AppData\\Roaming\\npm",
    );
    expect(spawnSyncMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to reg.exe when PowerShell returns only separators", () => {
    spawnSyncMock
      .mockReturnValueOnce(spawnSuccess(";\r\n"))
      .mockReturnValueOnce(
        spawnSuccess(
          [
            "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
            "    Path    REG_SZ    C:\\Windows\\system32",
          ].join("\r\n"),
        ),
      )
      .mockReturnValueOnce(spawnFailure());

    expect(readRefreshedWindowsPath("C:\\session-only")).toBe(
      "C:\\session-only;C:\\Windows\\system32",
    );
  });

  it("returns null when both registry readers fail", () => {
    spawnSyncMock.mockReturnValue(spawnFailure());

    expect(readRefreshedWindowsPath("C:\\session-only")).toBeNull();
  });
});
