import fs from "node:fs";
import * as path from "path";
import {
  NEXTJS_CONFIG_FILES,
  VITE_CONFIG_FILES,
  type AppFrameworkType,
} from "@/lib/framework_constants";

/**
 * Detect the framework type for an app by checking config files and package.json.
 *
 * Vite apps with a Nitro server layer (added via `enable_nitro`) are reported
 * as `"vite-nitro"`. Detection looks for `nitro.config.{ts,js,mjs}` first, then
 * falls back to `nitro` in package.json deps — either is sufficient since the
 * tool writes the config file and installs the package together.
 */
export function detectFrameworkType(appPath: string): AppFrameworkType | null {
  try {
    for (const config of NEXTJS_CONFIG_FILES) {
      if (fs.existsSync(path.join(appPath, config))) {
        return "nextjs";
      }
    }

    let isVite = false;
    for (const config of VITE_CONFIG_FILES) {
      if (fs.existsSync(path.join(appPath, config))) {
        isVite = true;
        break;
      }
    }

    let packageJsonDeps: Record<string, string> | null = null;
    const packageJsonPath = path.join(appPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const deps: Record<string, string> = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
      packageJsonDeps = deps;
      if (!isVite && deps.next) return "nextjs";
      if (!isVite && deps.vite) isVite = true;
    }

    if (isVite) {
      return hasNitro(appPath, packageJsonDeps) ? "vite-nitro" : "vite";
    }

    return "other";
  } catch {
    return null;
  }
}

function hasNitro(
  appPath: string,
  deps: Record<string, string> | null,
): boolean {
  const nitroConfigs = [
    "nitro.config.ts",
    "nitro.config.js",
    "nitro.config.mjs",
  ];
  for (const config of nitroConfigs) {
    if (fs.existsSync(path.join(appPath, config))) return true;
  }
  return Boolean(deps?.nitro);
}

/**
 * Read the Next.js major version from the app's package.json.
 * Returns null when next is not installed or the version string is non-numeric
 * (e.g. "latest", "canary", a git URL).
 */
export function detectNextJsMajorVersion(appPath: string): number | null {
  try {
    const packageJsonPath = path.join(appPath, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const nextVersion =
      packageJson.dependencies?.next ?? packageJson.devDependencies?.next;
    if (typeof nextVersion !== "string") {
      return null;
    }
    const match = nextVersion.match(/\d+/);
    if (!match) {
      return null;
    }
    return parseInt(match[0], 10);
  } catch {
    return null;
  }
}
