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

## Preview test automation

The "Run tests in preview panel" experiment does not enable Chromium's global
remote-debugging switch. During a run, `src/main/preview_cdp_broker.ts` opens an
ephemeral loopback endpoint protected by a random bearer token and attaches
Electron's `webContents.debugger` directly to the isolated preview
`WebContentsView`.

The broker presents Playwright with a synthetic browser containing exactly one
page. It rejects browser-global target discovery, target creation, arbitrary
target attachment, and other CDP commands that could escape the selected
preview. The endpoint closes and the debugger detaches when the run ends,
aborts, or loses its preview target.

Keep the broker deliberately incomplete. Adding a new `Browser.*`, `Target.*`,
`SystemInfo.*`, tracing, storage, permission, or download command requires a
security review proving it remains scoped to the preview's in-memory session.
