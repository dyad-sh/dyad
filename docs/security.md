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
- caps per-call file reads and total tool output

When users configure scripts to always allow, this path policy remains the sole
runtime guard. Keep it conservative when adding new host capabilities.
