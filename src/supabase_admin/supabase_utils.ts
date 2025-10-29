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
