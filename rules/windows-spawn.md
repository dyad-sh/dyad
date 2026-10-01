# Windows command spawning

Applies to anything that spawns a child process with arguments — `spawn_streaming`, `socket_firewall` (node-pty), and any new caller. All of them go through `src/ipc/utils/windows_command.ts`, which is the single source of truth so quoting/security fixes apply everywhere.

Electron's `will-quit` event does not await promises. Cleanup invoked there
must perform process-tree discovery and signal delivery synchronously; an async
tree-kill helper can leave grandchildren reparented and running after Electron
exits. Keep Windows quit cleanup on direct `taskkill.exe` argv and avoid
`cmd.exe` for this path.

- Windows PowerShell 5.1 turns piped native stderr into error records: avoid `$ErrorActionPreference = 'Stop'` in wrappers that must tolerate warnings, and propagate `$LASTEXITCODE`. Bound `-EncodedCommand` input before review; UTF-16/base64 expands it about 2.7 times against Windows' 32,767-character command-line limit.
- Do not invoke `taskkill` for a root PID after its `exit` event; it can already be reused while pipes are draining. Windows tree-kill already uses `/T /F`, so an additional delayed force-kill is unnecessary.

## A bare command name becomes a `.cmd` shim

`resolveWindowsExecutableName` appends `.cmd` to any command without a `.` in it (`npm` → `npm.cmd`), because that's what the command really is on Windows. This means **`node`, `npx`, and `npm` all take the `cmd.exe` path**, not the direct-exec path — only a name with an extension (`node.exe`) passes through unchanged. Assuming otherwise is an easy way to write a test that asserts the wrong branch.

## `%` and newlines cannot be passed through `cmd.exe`

`.cmd`/`.bat` shims can't be exec'd directly, so they're routed through `cmd.exe /d /s /c` with a single command string. Quoting each argument preserves shell metacharacters (`&`, `|`, `<`, `>`, `^`, `!`, `()`, spaces, quotes) — which is what lets a Playwright grep regex like `(adds|removes) item` survive — but two things quoting cannot contain:

- **`%`**: `cmd.exe` expands `%VAR%` even inside double quotes, and `%%` only escapes inside a batch file, not on a command line.
- **CR/LF**: `cmd.exe` treats newlines as command separators inside double quotes.

`quoteWindowsCmdArg` therefore **throws** on both rather than silently rewriting the value into a different command. Don't "fix" a throw by stripping the characters — a caller passing model- or user-supplied text (grep patterns, filenames) needs to fail loudly, not run a mangled or injected command. If a `%`-bearing argument must genuinely be supported, it needs a non-`cmd.exe` transport, not more escaping.
