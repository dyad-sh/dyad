# Windows command spawning

Applies to anything that spawns a child process with arguments — `spawn_streaming`, `socket_firewall` (node-pty), and any new caller. All of them go through `src/ipc/utils/windows_command.ts`, which is the single source of truth so quoting/security fixes apply everywhere.

Electron's `will-quit` event does not await promises. Cleanup invoked there
must perform process-tree discovery and signal delivery synchronously; an async
tree-kill helper can leave grandchildren reparented and running after Electron
exits. Keep Windows quit cleanup on direct `taskkill.exe` argv and avoid
`cmd.exe` for this path.

- Windows PowerShell 5.1 turns piped native stderr into error records: avoid `$ErrorActionPreference = 'Stop'` in wrappers that must tolerate warnings. Derive implicit exit status from the final `$?` (0/1), not stale `$LASTEXITCODE` from an earlier native command; explicit `exit` codes remain intact. Bound `-EncodedCommand` input before review; UTF-16/base64 expands it about 2.7 times against Windows' 32,767-character command-line limit.
- Do not invoke `taskkill` for a root PID after its `exit` event; it can already be reused while pipes are draining. Windows tree-kill already uses `/T /F`, so an additional delayed force-kill is unnecessary.

- PowerShell startup can exceed a short test timeout before the first command runs. For tool-level partial-edit tests, mock the process result and write the fixture during the mock; keep real deadline and shutdown checks in subprocess tests.

## Never let Git delete a tree that may contain junctions

Git for Windows treats a junction as an ordinary directory, and `npm`/`pnpm` create them on every install. `git worktree remove --force` on an installed tree therefore has two failure modes, neither involving a lock or a surviving process:

- **A live junction is deleted through.** The target's real files are erased and Git exits 0. An npm `file:` or pnpm `link:` dependency on an absolute path makes that target the user's own package. Reproduced with real installs of both.
- **A junction whose target Git already deleted is counted as gone**, so its parent's `rmdir` fails with `Directory not empty`. Every pnpm install hits this, because `.pnpm` links packages to each other. Whether it fails depends only on directory sort order, so a small fixture can pass by luck.

Git drops the worktree's registration even when it fails to delete the tree, so a retry only reports `is not a working tree`.

Delete with `fs.rm`, which removes a link without following it and was 2–5x faster than Git on real pnpm and npm trees, then run `git worktree remove --force` on the now-missing path to withdraw that one registration. Don't use `git worktree prune`: it is repository-wide, so it also forgets the user's worktrees on an unplugged drive, and it exits 0 when it could not delete the metadata. `removeGitOverlayWorkspace` is the one implementation. `git_overlay_workspace_teardown.integration.test.ts` guards it with real junctions, and `DYAD_LIVE_TEARDOWN_TEST=1` adds a real pnpm install and Vite server.

This applies to your own tooling too. A temporary worktree whose `node_modules` is a junction to the main checkout's, as in the pre-existing-failure check in `AGENTS.md`, would have the real `node_modules` emptied by `git worktree remove`. Delete the junction first, and confirm it is gone before removing the worktree.

## A bare command name becomes a `.cmd` shim

`resolveWindowsExecutableName` appends `.cmd` to any command without a `.` in it (`npm` → `npm.cmd`), because that's what the command really is on Windows. This means **`node`, `npx`, and `npm` all take the `cmd.exe` path**, not the direct-exec path — only a name with an extension (`node.exe`) passes through unchanged. Assuming otherwise is an easy way to write a test that asserts the wrong branch.

## `%` and newlines cannot be passed through `cmd.exe`

`.cmd`/`.bat` shims can't be exec'd directly, so they're routed through `cmd.exe /d /s /c` with a single command string. Quoting each argument preserves shell metacharacters (`&`, `|`, `<`, `>`, `^`, `!`, `()`, spaces, quotes) — which is what lets a Playwright grep regex like `(adds|removes) item` survive — but two things quoting cannot contain:

- **`%`**: `cmd.exe` expands `%VAR%` even inside double quotes, and `%%` only escapes inside a batch file, not on a command line.
- **CR/LF**: `cmd.exe` treats newlines as command separators inside double quotes.

`quoteWindowsCmdArg` therefore **throws** on both rather than silently rewriting the value into a different command. Don't "fix" a throw by stripping the characters — a caller passing model- or user-supplied text (grep patterns, filenames) needs to fail loudly, not run a mangled or injected command. If a `%`-bearing argument must genuinely be supported, it needs a non-`cmd.exe` transport, not more escaping.
