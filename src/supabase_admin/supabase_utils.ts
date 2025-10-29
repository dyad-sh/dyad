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
  const extension = path.posix.extname(trimmedPath);
  const hasExtension = extension !== "";

  if (hasExtension) {
    const parentDirectory = path.posix.dirname(trimmedPath);
    if (parentDirectory === "supabase/functions") {
      return path.posix.basename(trimmedPath, extension);
    }
    return path.posix.basename(parentDirectory);
  }

  return path.posix.basename(trimmedPath);
}
