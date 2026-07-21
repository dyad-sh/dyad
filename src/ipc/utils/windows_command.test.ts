import { describe, expect, it } from "vitest";
import {
  buildWindowsCommandInvocation,
  quoteWindowsCmdArg,
} from "./windows_command";

describe("quoteWindowsCmdArg", () => {
  it("leaves simple values unquoted and quotes shell-significant ones", () => {
    expect(quoteWindowsCmdArg("tests/home.spec.ts")).toBe("tests/home.spec.ts");
    expect(quoteWindowsCmdArg("")).toBe('""');
    // The whole point of routing through cmd.exe with quoting: a Playwright
    // grep regex keeps its metacharacters instead of being rejected.
    expect(quoteWindowsCmdArg("(adds|removes) item")).toBe(
      '"(adds|removes) item"',
    );
    expect(quoteWindowsCmdArg('say "hi"')).toBe('"say ""hi"""');
  });

  it("rejects values cmd.exe would reinterpret despite the quotes", () => {
    // `%VAR%` still expands and a newline still separates commands inside
    // double quotes, so these can't be passed through faithfully.
    expect(() => quoteWindowsCmdArg("shows 50% discount")).toThrow(/%/);
    expect(() => quoteWindowsCmdArg("a\nwhoami")).toThrow(/newline/);
    expect(() => quoteWindowsCmdArg("a\r\nwhoami")).toThrow(/newline/);
  });
});

describe("buildWindowsCommandInvocation", () => {
  it("routes a batch shim through cmd.exe with quoted args", () => {
    expect(
      buildWindowsCommandInvocation(
        "npx",
        ["playwright", "test", "--grep", "(a|b) c"],
        "win32",
        "cmd.exe",
      ),
    ).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", 'npx.cmd playwright test --grep "(a|b) c"'],
    });
  });

  it("passes real executables and non-Windows platforms through unchanged", () => {
    expect(
      buildWindowsCommandInvocation(
        "node.exe",
        ["a b", "50%"],
        "win32",
        "cmd.exe",
      ),
    ).toEqual({ command: "node.exe", args: ["a b", "50%"] });
    expect(
      buildWindowsCommandInvocation("npx", ["--grep", "50%"], "darwin"),
    ).toEqual({ command: "npx", args: ["--grep", "50%"] });
  });

  it("rejects an unquotable arg on the cmd.exe path", () => {
    expect(() =>
      buildWindowsCommandInvocation(
        "npx",
        ["playwright", "test", "--grep", "shows 50% off"],
        "win32",
        "cmd.exe",
      ),
    ).toThrow(/cmd\.exe/);
  });
});
