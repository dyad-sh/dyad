const WINDOWS_BATCH_COMMAND_PATTERN = /\.(cmd|bat)$/i;
const WINDOWS_CMD_NEEDS_QUOTING_PATTERN = /[\s"&|<>^%!()]/u;
// `%` and newlines survive quoting: `cmd.exe` expands `%VAR%` and treats CR/LF
// as command separators even inside double quotes, and neither has a
// command-line escape (`%%` only works inside a batch file).
const WINDOWS_CMD_UNQUOTABLE_PATTERN = /[%\r\n]/u;

/**
 * On Windows, a bare command name like `npm` is really the `npm.cmd` shim.
 * Node's spawn (and node-pty) won't find it without the extension.
 */
export function resolveWindowsExecutableName(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32" && !command.includes(".")) {
    return `${command}.cmd`;
  }
  return command;
}

/**
 * Quote one argument of a `cmd.exe /d /s /c` command string. `cmd.exe` strips
 * the outer quotes of the command string, so simple args stay unquoted while
 * empty or shell-significant values are quoted with `"` doubled.
 *
 * Throws on `%` and CR/LF, which quoting cannot contain: `%VAR%` would still
 * expand and a newline would still separate commands. Rejecting them keeps a
 * value that can't be passed through faithfully from being silently rewritten
 * into a different — possibly injected — command.
 */
export function quoteWindowsCmdArg(value: string): string {
  if (WINDOWS_CMD_UNQUOTABLE_PATTERN.test(value)) {
    throw new Error(
      `Cannot pass argument through cmd.exe: '%' and newlines are not escapable in a command string. Received: ${JSON.stringify(value)}`,
    );
  }
  if (value !== "" && !WINDOWS_CMD_NEEDS_QUOTING_PATTERN.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Resolve `command`/`args` into what should actually be launched. On Windows,
 * `.cmd`/`.bat` shims can't be executed directly, so they're routed through an
 * explicit `cmd.exe /d /s /c` invocation with each arg quoted as needed — this
 * preserves valid arguments (e.g. a Playwright grep regex containing `()` or
 * `|`) without handing an unquoted command string to a shell. Non-Windows
 * platforms and real executables pass through unchanged.
 *
 * Throws on the batch path for arguments containing `%` or newlines — see
 * `quoteWindowsCmdArg`.
 *
 * Single source of truth for both spawn (`spawn_streaming`) and node-pty
 * (`socket_firewall`) callers so quoting/security fixes apply to both.
 *
 * The batch path returns `useVerbatimArguments: true` because the `/c` payload
 * is already a fully cmd-escaped command string wrapped in the outer pair of
 * quotes that `/s` strips. Spawners MUST forward `args` verbatim — Node's
 * `child_process.spawn` via `windowsVerbatimArguments: true`, and node-pty by
 * passing the args as a single pre-built command-line string — so libuv /
 * node-pty don't apply a *second* MSVC `\"` argv-escaping layer on top of
 * `quoteWindowsCmdArg`'s cmd-style `""` doubling. Without the outer pair AND
 * the verbatim handoff, every quoted argument (spaces, `&|<>()^"!`, empty
 * string) is corrupted on the way to the child.
 */
export function buildWindowsCommandInvocation(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comSpec = process.env.ComSpec ?? "cmd.exe",
): { command: string; args: string[]; useVerbatimArguments?: true } {
  const resolvedCommand = resolveWindowsExecutableName(command, platform);

  if (
    platform === "win32" &&
    WINDOWS_BATCH_COMMAND_PATTERN.test(resolvedCommand)
  ) {
    const commandString = [resolvedCommand, ...args]
      .map(quoteWindowsCmdArg)
      .join(" ");
    return {
      command: comSpec,
      // The outer pair of quotes is consumed by `/s`: cmd.exe strips the first
      // and last `"` of the `/c` payload, leaving exactly `commandString` —
      // `quoteWindowsCmdArg`'s cmd-style quoting — for cmd.exe to tokenize.
      args: ["/d", "/s", "/c", `"${commandString}"`],
      useVerbatimArguments: true,
    };
  }

  return { command: resolvedCommand, args };
}
