import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";

export function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function* packageJsonCandidates(
  appPath: string,
  packagePathSegments: readonly string[],
): Generator<string> {
  if (
    packagePathSegments.length === 0 ||
    packagePathSegments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\"),
    )
  ) {
    throw new TypeError("Invalid node_modules package path segments");
  }
  let currentPath = path.resolve(appPath);
  while (true) {
    yield path.join(
      currentPath,
      "node_modules",
      ...packagePathSegments,
      "package.json",
    );
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return;
    }
    currentPath = parentPath;
  }
}

export async function resolveNodeModulePackageJsonPath(
  appPath: string,
  packagePathSegments: readonly string[],
): Promise<string> {
  let lastMissingPathError: unknown;
  for (const candidate of packageJsonCandidates(appPath, packagePathSegments)) {
    try {
      await fsPromises.access(candidate);
      return candidate;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      lastMissingPathError = error;
    }
  }
  throw lastMissingPathError;
}

export function resolveNodeModulePackageJsonPathSync(
  appPath: string,
  packagePathSegments: readonly string[],
): string {
  let lastMissingPathError: unknown;
  for (const candidate of packageJsonCandidates(appPath, packagePathSegments)) {
    try {
      fs.accessSync(candidate);
      return candidate;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      lastMissingPathError = error;
    }
  }
  throw lastMissingPathError;
}

export function resolveTypeScriptPackageJsonPath(
  appPath: string,
): Promise<string> {
  return resolveNodeModulePackageJsonPath(appPath, ["typescript"]);
}

export function resolveTypeScriptPackageJsonPathSync(appPath: string): string {
  return resolveNodeModulePackageJsonPathSync(appPath, ["typescript"]);
}

export function getNodeModuleEntryPath(
  packageJsonPath: string,
  fallbackRelativePath: string,
): string {
  const packageRootPath = path.dirname(packageJsonPath);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    main?: unknown;
  };
  return path.resolve(
    packageRootPath,
    typeof packageJson.main === "string"
      ? packageJson.main
      : fallbackRelativePath,
  );
}

export function clearNodeModuleCache(
  realPackageRootPath: string,
  moduleCache: NodeJS.Dict<NodeModule>,
): void {
  for (const cachedPath of Object.keys(moduleCache)) {
    const relativePath = path.relative(realPackageRootPath, cachedPath);
    if (
      relativePath === "" ||
      (relativePath !== ".." &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath))
    ) {
      delete moduleCache[cachedPath];
    }
  }
}

export function getTypeScriptCompilerPath(packageJsonPath: string): string {
  return getNodeModuleEntryPath(packageJsonPath, "lib/typescript.js");
}

export function getTypeScriptCliPath(packageJsonPath: string): string {
  return path.join(path.dirname(packageJsonPath), "lib", "tsc.js");
}
