import { describe, expect, it } from "vitest";

import {
  expandWindowsEnvVars,
  mergeWindowsPathSegments,
  parseRegQueryPathOutput,
} from "./windows_env_path";

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
});
