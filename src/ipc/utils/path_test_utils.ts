import path from "node:path";

export function resolveSelfAlias(appPath: string, filePath: unknown): string {
  const targetPath = String(filePath);
  const aliasPath = path.join(appPath, "self");
  const relativePath = path.relative(aliasPath, targetPath);
  if (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  ) {
    return path.join(appPath, relativePath);
  }
  return targetPath;
}
