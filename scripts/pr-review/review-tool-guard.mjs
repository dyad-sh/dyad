import fs from "node:fs";
import path from "node:path";

// This hook is loaded from the trusted checkout, never from PR content. All
// paths are checked before tools run; the agent can edit only its two outputs.
let workspace;
const outputs = new Set([
  "tmp/pr-review/claude-review.md",
  "tmp/pr-review/claude-findings.json",
]);
const contextPath = "tmp/pr-review/claude-context.json";
const privateDirectories = new Set([
  ".git",
  ".claude",
  ".claude-pr",
  ".agents",
  "node_modules",
]);

function relativeName(filename) {
  const relative = path.relative(workspace, filename);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Files outside the trusted workspace are unavailable.");
  }
  return relative.split(path.sep).join("/");
}

function assertReadable(filename) {
  const relative = relativeName(filename);
  if (
    relative
      .split("/")
      .some(
        (part) => privateDirectories.has(part) || part.startsWith(".env"),
      ) ||
    (relative.startsWith("tmp/") &&
      relative !== contextPath &&
      !outputs.has(relative)) ||
    relative === "tmp"
  ) {
    throw new Error(
      "Credential, configuration, and temporary paths are unavailable.",
    );
  }
}

// A recursive search must not follow a nested symlink to credentials, nor scan
// runtime files under an otherwise permitted ancestor (e.g. .git at repo root).
function assertSearchTree(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    assertReadable(filename);
    if (entry.isSymbolicLink()) {
      throw new Error(
        "Search a directory without symlinks, or Read the source file directly.",
      );
    }
    if (entry.isDirectory()) assertSearchTree(filename);
  }
}

try {
  workspace = fs.realpathSync(process.argv[2]);
  const event = JSON.parse(fs.readFileSync(0, "utf8"));
  const { tool_name: tool, tool_input: input } = event;
  if (event.hook_event_name !== "PreToolUse" || !input) {
    throw new Error("Invalid review tool request.");
  }
  const writing = tool === "Edit" || tool === "Write";
  const searching = tool === "Grep" || tool === "Glob";
  if (!writing && !searching && tool !== "Read") {
    throw new Error(
      "Only static file inspection and review artifact writes are permitted.",
    );
  }
  const supplied = searching ? (input.path ?? ".") : input.file_path;
  if (typeof supplied !== "string" || !supplied) {
    throw new Error("A file or directory path is required.");
  }
  const filename = path.resolve(workspace, supplied);
  assertReadable(filename);
  if (writing) {
    if (!outputs.has(relativeName(filename))) {
      throw new Error(
        "Only the two mandatory review artifacts may be written.",
      );
    }
    // The context builder creates the output directory before Claude starts.
    // Resolve existing targets too, so artifact symlinks cannot escape the guard.
    const existing = fs.lstatSync(filename, { throwIfNoEntry: false });
    if (existing && !existing.isFile()) {
      throw new Error("Only regular artifact files may be written.");
    }
    const resolved = existing
      ? fs.realpathSync(filename)
      : path.join(
          fs.realpathSync(path.dirname(filename)),
          path.basename(filename),
        );
    if (resolved !== filename)
      throw new Error("Artifact symlinks are unavailable.");
  } else {
    const resolved = fs.realpathSync(filename);
    assertReadable(resolved);
    if (tool === "Read" && !fs.statSync(resolved).isFile()) {
      throw new Error("Read a regular source file, not a directory or device.");
    }
    if (searching) {
      for (const pattern of [
        input.glob,
        tool === "Glob" ? input.pattern : undefined,
      ]) {
        if (
          pattern !== undefined &&
          (typeof pattern !== "string" ||
            pattern.includes("..") ||
            path.isAbsolute(pattern) ||
            path.win32.isAbsolute(pattern))
        ) {
          throw new Error(
            "Search patterns must stay inside the selected source directory.",
          );
        }
      }
      if (fs.statSync(resolved).isDirectory()) {
        if (resolved === workspace) {
          throw new Error(
            "Search a source subdirectory such as src, rules, docs, or scripts, not the workspace root.",
          );
        }
        assertSearchTree(resolved);
      }
    }
  }
} catch {
  // Never echo input or filesystem errors: they may contain sensitive content.
  console.error(
    "Review tool blocked: inspect trusted source subdirectories or the context file; write only the two review artifacts. Credential paths, outside paths, and symlink searches are unavailable.",
  );
  process.exit(2);
}
