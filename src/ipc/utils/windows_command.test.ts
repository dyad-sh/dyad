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
      // The `/c` payload is wrapped in an outer pair of quotes that `/s`
      // strips; the inner `"…"` is the cmd-style quoting from
      // `quoteWindowsCmdArg`. `useVerbatimArguments` tells spawners to forward
      // this verbatim instead of re-escaping it.
      args: ["/d", "/s", "/c", '"npx.cmd playwright test --grep "(a|b) c""'],
      useVerbatimArguments: true,
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

// ---------------------------------------------------------------------------
// Round-trip regression tests.
//
// The bug this guards against lives one layer BENEATH this file: after the
// JS argv array is handed to `child_process.spawn` / `node-pty, if the
// spawner does not opt into verbatim args, libuv and node-pty run their MSVC
// `\"` argv-to-command-line escaping (`quote_cmd_arg` / `argsToCommandLine`)
// on the already cmd-quoted `/c` payload. With `/s`, cmd.exe strips the first
// and last `"` of that payload and tokenizes the remainder, so a layer of `\"
// escaping on top of `quoteWindowsCmdArg`'s `""` doubling corrupts every
// quoted argument (e.g. `C:\Program Files\app` arrives as
// `\C:\Program Files\app\\`).
//
// No CI job runs a real `cmd.exe` round trip, so these tests model the
// post-fix pipeline (`/s` strip → cmd tokenize) in pure JS and assert the
// recovered child argv equals the caller's original args. They guard the
// combined behavior of the outer-quote wrap and the `useVerbatimArguments`
// flag — the layer the original bug lived below.
// ---------------------------------------------------------------------------

/** Faithful port of cmd.exe's `/s` rule: if the command string starts with
 * `"`, strip that leading `"` and the LAST `"` on the string (preserving any
 * text after it). */
function stripSQuote(s: string): string {
  if (s[0] !== '"') return s;
  const last = s.lastIndexOf('"');
  return last <= 0 ? s : s.slice(1, last) + s.slice(last + 1);
}

/** cmd.exe `/c` tokenizer: spaces separate tokens outside quotes; `"` toggles
 * quote mode; `""` inside quotes is a literal `"`. A `""` pair denotes an
 * empty token. This is the inverse of `quoteWindowsCmdArg`. */
function cmdTokenize(s: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let hasToken = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      hasToken = true;
      if (inQuotes && s[i + 1] === '"') {
        current += '"';
        i += 2;
      } else {
        inQuotes = !inQuotes;
        i += 1;
      }
      continue;
    }
    if ((ch === " " || ch === "\t") && !inQuotes) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      i += 1;
      continue;
    }
    current += ch;
    hasToken = true;
    i += 1;
  }
  if (hasToken) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * Recover the child's argv from the `/c` payload a `buildWindowsCommandInvocation`
 * batch invocation produces, modeling the post-fix pipeline: with
 * `windowsVerbatimArguments: true` the `/c` payload reaches cmd.exe unchanged,
 * so `/s` strips the outer pair of quotes and cmd tokenizes the inner
 * cmd-escaped string. This is the inverse of `quoteWindowsCmdArg` joined with
 * the `/s` rule, and is the only place that exercises the combined effect of
 * the outer-quote wrap and the verbatim-args flag — the layer the original
 * bug lived below.
 */
function recoverChildArgv(args: string[]): string[] {
  return cmdTokenize(stripSQuote(args[3])).slice(1);
}

describe("buildWindowsCommandInvocation: end-to-end round trip", () => {
  const cases: Array<{ name: string; args: string[] }> = [
    {
      name: "path containing spaces",
      args: ["install", "--prefix", "C:\\Program Files\\app"],
    },
    {
      name: "Playwright grep regex with () and |",
      args: ["playwright", "test", "--grep", "(a|b) c"],
    },
    { name: "explicit empty argument", args: ["--flag", ""] },
    {
      name: "argument with embedded quotes",
      args: ["--message", 'value with spaces and "quotes"'],
    },
  ];

  it.each(cases)(
    "delivers $name verbatim to the child (recovers argv exactly)",
    ({ args }) => {
      const invocation = buildWindowsCommandInvocation(
        "npx",
        args,
        "win32",
        "cmd.exe",
      );
      // The batch path must opt out of MSVC re-escaping.
      expect(invocation.useVerbatimArguments).toBe(true);
      // The `/c` payload must be wrapped in the outer pair of quotes `/s`
      // strips — otherwise a spaced .cmd shim path can't survive.
      expect(invocation.args[3].startsWith('"')).toBe(true);
      expect(invocation.args[3].endsWith('"')).toBe(true);
      // After libuv/node-pty pass it through verbatim and cmd.exe parses it,
      // the child's argv matches the caller's args exactly.
      expect(recoverChildArgv(invocation.args)).toEqual(args);
    },
  );

  it("preserves a space-containing .cmd shim path through the outer /s pair", () => {
    // A spaced shim path is the case `windowsVerbatimArguments: true` alone
    // (without the outer pair) would mis-parse: `/s` would strip the path's
    // own quotes and split it on the space. With the outer pair, the inner
    // quotes survive.
    const invocation = buildWindowsCommandInvocation(
      "C:\\Program Files\\app\\npx.cmd",
      ["test"],
      "win32",
      "cmd.exe",
    );
    expect(invocation.useVerbatimArguments).toBe(true);
    const recovered = recoverChildArgv(invocation.args);
    expect(recovered).toEqual(["test"]);
  });
});
