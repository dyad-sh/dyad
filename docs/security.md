# Security Notes

## MustardScript Attachment Scripts

Dyad uses MustardScript for local-agent attachment inspection. The tool is
read-only: it exposes `read_file`, `list_files`, and `file_stats`, and does not
expose shell execution, network access, environment variables, or write
capabilities.

MustardScript runs in-process and is not treated as a hard security boundary.
The effective security control is the host path policy in
`src/ipc/utils/sandbox/capabilities.ts`.

That policy:

- rejects absolute paths, home paths, UNC paths, and `..` traversal
- resolves symlinks and rejects files outside the current app path
- denies protected paths including `.env*`, `.git/`, `node_modules/`,
  `.ssh/`, `.aws/`, `.config/`, `.netrc`, `*.key`, and `*.pem`
- allows `.dyad/` paths within the app (attachments, script output, etc.)
  while still rejecting paths outside the resolved app root
- caps per-call file reads and total tool output

When users configure scripts to always allow, this path policy remains the sole
runtime guard. Keep it conservative when adding new host capabilities.

## Accepted risk: the "Run tests in preview panel" experiment opens a CDP port

`src/main/remote_debugging.ts` appends `--remote-debugging-port=0` at process
startup whenever the `enableTestRunInPreview` experiment flag is set on disk.
Playwright needs that endpoint to drive the preview `WebContentsView` over CDP;
Chromium only accepts the switch during startup, so it cannot be scoped to the
duration of a run without relaunching the app.

**What the exposure is.** Chromium's DevTools endpoint is unauthenticated. It
binds to `127.0.0.1` only, and the OS-assigned port is published in
`DevToolsActivePort` inside the Electron profile directory. Any local process
that can read that file — a dependency's postinstall script, a generated app's
dev server, an MCP server — can attach and evaluate JavaScript in **every**
`webContents` in the process. That includes Dyad's own privileged renderer,
which holds the preload IPC bridge to the filesystem, git, terminal, deploy
credentials, and provider API keys. The endpoint stays open for the whole
session, not just while tests run.

**The decision.** Accepted as a documented trade-off for an experiment, rather
than blocked on a narrower design (a port opened per-run behind a relaunch, or
a token-authenticated endpoint). This is recorded here so the next person to
touch the experiment inherits the reasoning rather than rediscovering it — and
so promoting the experiment out of Experiments is an explicit decision to
revisit it, not a default.

**What bounds it today.**

- The flag is off by default and takes effect only after a restart.
- The Settings switch (`src/components/TestRunInPreviewSwitch.tsx`) states that
  the port is open for the whole session, not just during runs, and tells the
  user to turn it off and restart when done.
- The Tests panel shows a persistent amber notice
  (`tests-panel-debug-port-notice`) whenever the port is actually open, naming
  the setting to switch off — so the exposure is visible where the feature is
  used, not only in a Settings page the user saw once.
- The preview `WebContentsView` itself runs untrusted app code sandboxed, with
  no preload, no Node, and its own in-memory session per test.

**Before this graduates out of Experiments**, narrow the exposure: scope the
port to a run (accepting the relaunch), gate attach on a per-session token, or
refuse the switch in packaged builds.
