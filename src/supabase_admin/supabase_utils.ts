import type { Dirent } from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";

export function isServerFunction(filePath: string) {
  return filePath.startsWith("supabase/functions/");
}

export function getSupabaseFunctionName(filePath: string): string {
  const normalizedPath = filePath.split(path.sep).join(path.posix.sep);

  if (!normalizedPath.startsWith("supabase/functions/")) {
    return path.posix.basename(normalizedPath);
  }

  const trimmedPath = normalizedPath.replace(/\/$/, "");
  const withoutPrefix = trimmedPath.slice("supabase/functions/".length);
  const [firstSegment = ""] = withoutPrefix.split("/");

  if (firstSegment === "") {
    return "";
  }

  const extension = path.posix.extname(firstSegment);
  return extension ? firstSegment.slice(0, -extension.length) : firstSegment;
}

export function isSupabaseSharedFile(filePath: string): boolean {
  const normalizedPath = filePath.split(path.sep).join(path.posix.sep);
  return (
    normalizedPath === "supabase/functions/_shared" ||
    normalizedPath.startsWith("supabase/functions/_shared/")
  );
}

const SUPPORTED_FUNCTION_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
]);

export async function listSupabaseFunctionTargets(appPath: string): Promise<
  Array<{ name: string; fullPath: string }>
> {
  const functionsDirectory = path.join(appPath, "supabase", "functions");

  let dirEntries: Dirent[];
  try {
    dirEntries = await fsPromises.readdir(functionsDirectory, {
      withFileTypes: true,
    });
  } catch (error: any) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const results: Array<{ name: string; fullPath: string }> = [];

  for (const entry of dirEntries) {
    if (entry.name === "_shared") {
      continue;
    }

    const fullPath = path.join(functionsDirectory, entry.name);

    if (entry.isDirectory()) {
      results.push({ name: entry.name, fullPath });
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name);
    if (!SUPPORTED_FUNCTION_EXTENSIONS.has(extension)) {
      continue;
    }

    const baseName = entry.name.slice(0, -extension.length);
    if (baseName) {
      results.push({ name: baseName, fullPath });
    }
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}
