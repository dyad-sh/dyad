/**
 * Which folders of an app can be deployed as a Cloudflare Worker.
 *
 * A target is a folder that says how to run itself on Workers: one holding a
 * Wrangler config, or a Nitro app, whose build writes the Worker and its
 * Wrangler config itself once the deploy rule sets the Cloudflare preset.
 * Cloudflare builds from the GitHub repository, so detection runs over the
 * app's committed files rather than over anything Dyad would have to generate.
 */

import { NITRO_CONFIG_FILES } from "@/lib/framework_constants";

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

/**
 * A Nitro app is found the way the framework detection finds Nitro: a Nitro
 * config, or the `nitro` dependency in the manifest.
 */
export type CloudflareTarget =
  | {
      kind: "wrangler";
      /** Path from the repository root, "" for the root itself. POSIX separators. */
      rootDirectory: string;
      /** Path of the Wrangler config from the repository root. */
      configPath: string;
      /**
       * Whether the folder is also a Nitro app. Nitro merges the config into
       * the one its build generates, and that build only produces a Worker
       * under the Cloudflare preset.
       */
      nitro: boolean;
    }
  | {
      /** A Nitro app with no Wrangler config of its own. */
      kind: "nitro";
      rootDirectory: string;
    };

/** Whether the target's build needs the Cloudflare preset to produce a Worker. */
export function buildsWithNitro(target: CloudflareTarget): boolean {
  return target.kind === "nitro" || target.nitro;
}

function configPriority(fileName: string): number {
  const index = (WRANGLER_CONFIG_FILES as readonly string[]).indexOf(fileName);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function depth(rootDirectory: string): number {
  return rootDirectory === "" ? 0 : rootDirectory.split("/").length;
}

/** A repository path split into its folder and file name, or null when it is in an ignored folder. */
function splitPath(
  rawFile: string,
): { rootDirectory: string; fileName: string } | null {
  const file = rawFile.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = file.split("/");
  const directories = segments.slice(0, -1);
  if (directories.some((segment) => IGNORED_DIRECTORIES.has(segment))) {
    return null;
  }
  return {
    rootDirectory: directories.join("/"),
    fileName: segments[segments.length - 1],
  };
}

function dependsOnNitro(manifest: string): boolean {
  try {
    const parsed = JSON.parse(manifest) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    return Boolean(parsed.dependencies?.nitro ?? parsed.devDependencies?.nitro);
  } catch {
    return false;
  }
}

/**
 * Finds every target in a list of repository-relative file paths.
 *
 * A folder with a Wrangler config is deployed as that config says. Any other
 * folder is a target when it is a Nitro app. Telling takes reading manifests;
 * `readFile` returns a committed file's contents, or null when it cannot be
 * read.
 *
 * Sorted shallowest first, then alphabetically, so the first entry is the
 * default selection.
 */
export async function detectCloudflareTargets(
  files: string[],
  readFile: (path: string) => Promise<string | null>,
): Promise<CloudflareTarget[]> {
  const configByDirectory = new Map<string, string>();
  const nitroDirectories = new Set<string>();
  const manifestsToRead: { rootDirectory: string; path: string }[] = [];

  for (const rawFile of files) {
    const split = splitPath(rawFile);
    if (!split) continue;
    const { rootDirectory, fileName } = split;
    const file =
      rootDirectory === "" ? fileName : `${rootDirectory}/${fileName}`;
    if ((WRANGLER_CONFIG_FILES as readonly string[]).includes(fileName)) {
      const existing = configByDirectory.get(rootDirectory);
      // Keep the config Wrangler would pick when a folder has several.
      if (
        existing === undefined ||
        configPriority(fileName) <
          configPriority(existing.slice(existing.lastIndexOf("/") + 1))
      ) {
        configByDirectory.set(rootDirectory, file);
      }
    } else if (NITRO_CONFIG_FILES.includes(fileName)) {
      nitroDirectories.add(rootDirectory);
    } else if (fileName === "package.json") {
      manifestsToRead.push({ rootDirectory, path: file });
    }
  }

  // Each read is a git call, so they run together.
  await Promise.all(
    manifestsToRead
      .filter(({ rootDirectory }) => !nitroDirectories.has(rootDirectory))
      .map(async ({ rootDirectory, path }) => {
        const contents = await readFile(path);
        if (contents !== null && dependsOnNitro(contents)) {
          nitroDirectories.add(rootDirectory);
        }
      }),
  );

  const targets: CloudflareTarget[] = [
    ...[...configByDirectory.entries()].map(
      ([rootDirectory, configPath]): CloudflareTarget => ({
        kind: "wrangler",
        rootDirectory,
        configPath,
        nitro: nitroDirectories.has(rootDirectory),
      }),
    ),
    ...[...nitroDirectories]
      .filter((rootDirectory) => !configByDirectory.has(rootDirectory))
      .map(
        (rootDirectory): CloudflareTarget => ({ kind: "nitro", rootDirectory }),
      ),
  ];
  return targets.sort(
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
