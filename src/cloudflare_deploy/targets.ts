/**
 * Which folders of an app can be deployed as a Cloudflare Worker.
 *
 * A target is a folder holding a Wrangler config. Cloudflare builds from the
 * GitHub repository, so detection runs over the app's file list rather than
 * over anything Dyad would have to generate.
 */

/** In the order Wrangler itself looks for them, so the first found is the one it uses. */
export const WRANGLER_CONFIG_FILES = [
  "wrangler.json",
  "wrangler.jsonc",
  "wrangler.toml",
] as const;

/** Folders that hold build output or dependencies, never a deployable Worker. */
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".output",
  ".wrangler",
  "dist",
  "build",
  ".git",
]);

export interface CloudflareTarget {
  /** Path from the repository root, "" for the root itself. POSIX separators. */
  rootDirectory: string;
  /** Path of the Wrangler config from the repository root. */
  configPath: string;
}

function configPriority(fileName: string): number {
  const index = (WRANGLER_CONFIG_FILES as readonly string[]).indexOf(fileName);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function depth(rootDirectory: string): number {
  return rootDirectory === "" ? 0 : rootDirectory.split("/").length;
}

/**
 * Finds every target in a list of repository-relative file paths.
 *
 * Sorted shallowest first, then alphabetically, so the first entry is the
 * default selection.
 */
export function detectCloudflareTargets(files: string[]): CloudflareTarget[] {
  const byDirectory = new Map<string, string>();

  for (const rawFile of files) {
    const file = rawFile.replace(/\\/g, "/").replace(/^\.\//, "");
    const segments = file.split("/");
    const fileName = segments[segments.length - 1];
    if (!(WRANGLER_CONFIG_FILES as readonly string[]).includes(fileName)) {
      continue;
    }
    const directories = segments.slice(0, -1);
    if (directories.some((segment) => IGNORED_DIRECTORIES.has(segment))) {
      continue;
    }
    const rootDirectory = directories.join("/");
    const existing = byDirectory.get(rootDirectory);
    // Keep the config Wrangler would pick when a folder has several.
    if (
      existing === undefined ||
      configPriority(fileName) <
        configPriority(existing.slice(existing.lastIndexOf("/") + 1))
    ) {
      byDirectory.set(rootDirectory, file);
    }
  }

  return [...byDirectory.entries()]
    .map(([rootDirectory, configPath]) => ({ rootDirectory, configPath }))
    .sort(
      (a, b) =>
        depth(a.rootDirectory) - depth(b.rootDirectory) ||
        a.rootDirectory.localeCompare(b.rootDirectory),
    );
}

/** How a target is named in the UI. */
export function describeCloudflareTarget(target: CloudflareTarget): string {
  return target.rootDirectory === "" ? "App root" : target.rootDirectory;
}

/**
 * Reads the top-level `name` from a Wrangler config without a full parser.
 *
 * Returns null when there is no name or the file cannot be understood, in which
 * case the caller falls back to a name derived from the app.
 */
export function readWranglerWorkerName(
  configPath: string,
  contents: string,
): string | null {
  const name = configPath.endsWith(".toml")
    ? readTomlTopLevelName(contents)
    : readJsoncTopLevelName(contents);
  return name && name.trim() !== "" ? name.trim() : null;
}

function readTomlTopLevelName(contents: string): string | null {
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    // A table header ends the top level; `name` after it belongs to the table.
    if (line.startsWith("[")) {
      return null;
    }
    const match = /^name\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(line);
    if (match) {
      return match[1] ?? match[2] ?? null;
    }
  }
  return null;
}

function readJsoncTopLevelName(contents: string): string | null {
  try {
    const parsed: unknown = JSON.parse(stripJsonComments(contents));
    if (parsed && typeof parsed === "object" && "name" in parsed) {
      const name = (parsed as { name: unknown }).name;
      return typeof name === "string" ? name : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Removes line and block comments, leaving string contents alone so a URL
 * inside a value survives, then drops trailing commas. The comma pass is not
 * string-aware, which is fine here: only `name` is read, and a Worker name
 * cannot contain a comma or a bracket.
 */
function stripJsonComments(contents: string): string {
  let result = "";
  let inString = false;
  for (let i = 0; i < contents.length; i++) {
    const char = contents[i];
    const next = contents[i + 1];
    if (inString) {
      result += char;
      if (char === "\\") {
        result += next ?? "";
        i++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < contents.length && contents[i] !== "\n") i++;
      result += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (
        i < contents.length &&
        !(contents[i] === "*" && contents[i + 1] === "/")
      ) {
        i++;
      }
      i++;
      continue;
    }
    result += char;
  }
  return result.replace(/,(\s*[}\]])/g, "$1");
}
