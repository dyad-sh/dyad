import fs from "node:fs";
import * as path from "path";
import {
  NEXTJS_CONFIG_FILES,
  type AppFrameworkType,
} from "@/lib/framework_constants";

/**
 * Detect the framework type for an app by checking config files and package.json.
 */
export function detectFrameworkType(appPath: string): AppFrameworkType | null {
  try {
    for (const config of NEXTJS_CONFIG_FILES) {
      if (fs.existsSync(path.join(appPath, config))) {
        return "nextjs";
      }
    }

    const viteConfigs = ["vite.config.js", "vite.config.ts", "vite.config.mjs"];
    for (const config of viteConfigs) {
      if (fs.existsSync(path.join(appPath, config))) {
        return "vite";
      }
    }

    // Fallback: check package.json dependencies
    const packageJsonPath = path.join(appPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
      if (deps.next) return "nextjs";
      if (deps.vite) return "vite";
    }

    return "other";
  } catch {
    return null;
  }
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
