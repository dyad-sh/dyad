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

## Agent Bash Commands

The agent `bash` tool executes an arbitrary host shell command; its app-root
working directory is not a security boundary. This is an explicit,
user-approved host capability rather than a sandbox. Dyad shows the complete
command and requires approval for every invocation, even when other changes
are auto-approved. The child receives a small allowlist of non-secret
environment variables, and Dyad checks for workspace mutations after both
successful and failed commands. That signal covers user-visible Git paths;
ignored dependencies and Dyad-managed internals do not trigger checkpoints.
