# Windows command spawning

Applies to anything that spawns a child process with arguments — `spawn_streaming`, `socket_firewall` (node-pty), and any new caller. All of them go through `src/ipc/utils/windows_command.ts`, which is the single source of truth so quoting/security fixes apply everywhere.

## A bare command name becomes a `.cmd` shim

`resolveWindowsExecutableName` appends `.cmd` to any command without a `.` in it (`npm` → `npm.cmd`), because that's what the command really is on Windows. This means **`node`, `npx`, and `npm` all take the `cmd.exe` path**, not the direct-exec path — only a name with an extension (`node.exe`) passes through unchanged. Assuming otherwise is an easy way to write a test that asserts the wrong branch.

## `%` and newlines cannot be passed through `cmd.exe`

`.cmd`/`.bat` shims can't be exec'd directly, so they're routed through `cmd.exe /d /s /c` with a single command string. Quoting each argument preserves shell metacharacters (`&`, `|`, `<`, `>`, `^`, `!`, `()`, spaces, quotes) — which is what lets a Playwright grep regex like `(adds|removes) item` survive — but two things quoting cannot contain:

- **`%`**: `cmd.exe` expands `%VAR%` even inside double quotes, and `%%` only escapes inside a batch file, not on a command line.
- **CR/LF**: `cmd.exe` treats newlines as command separators inside double quotes.

`quoteWindowsCmdArg` therefore **throws** on both rather than silently rewriting the value into a different command. Don't "fix" a throw by stripping the characters — a caller passing model- or user-supplied text (grep patterns, filenames) needs to fail loudly, not run a mangled or injected command. If a `%`-bearing argument must genuinely be supported, it needs a non-`cmd.exe` transport, not more escaping.
