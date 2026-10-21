# Security Notes

## MustardScript Attachment Scripts

Dyad uses MustardScript for local-agent attachment inspection. Every script
gets `read_file`, `list_files`, and `file_stats`, and no shell execution,
network access, or environment variables. In read-only and plan mode that is
all a script can do.

In a writable Agent turn a script can also get two more capabilities:

- `write_file`: exposed when the `write_file` tool is available in the turn and
  its permission is not set to "never". With default settings (sandbox script
  execution on, `write_file` set to "always") this is the case in normal Agent
  turns. The permission is re-read on every call, so switching it to "never"
  takes effect immediately. Unlike reads, writes accept only app-relative
  paths: `attachments:` paths and protected paths, including `.env*`, are
  rejected. Writes also check symlink containment and require an approved app
  blueprint when blueprints are enabled.
- MCP tools: when sandbox script execution is enabled and
  `execute_sandbox_script` is available in the turn (not in Build, read-only,
  or plan mode), the user's configured MCP tools are exposed as host functions.
  Each call can trigger the MCP consent prompt, and a denied call throws. An
  MCP tool can reach whatever its server can reach, including the network.

See `src/pro/main/ipc/handlers/local_agent/tools/execute_sandbox_script.ts`.

MustardScript runs in-process and is not treated as a hard security boundary.
The effective security control is the host path policy in
`src/ipc/utils/sandbox/capabilities.ts`.

That policy:

- rejects absolute paths, home paths, UNC paths, and `..` traversal
- resolves symlinks and rejects files outside the current app path
- denies protected paths including `.git/`, `node_modules/`, `.ssh/`,
  `.aws/`, `.config/`, `.netrc`, `*.key`, and `*.pem`
- treats `.env*` files specially: `read_file` returns them with every value
  redacted, `file_stats` reports their metadata, and writes to them are
  rejected
- allows `.dyad/` paths within the app (attachments, script output, etc.)
  while still rejecting paths outside the resolved app root
- caps per-call file reads and total tool output

When users configure scripts to always allow, this path policy remains the sole
runtime guard for file access, while `write_file` and MCP calls keep the tool
permission and consent checks described above. Keep the policy conservative
when adding new host capabilities.

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
