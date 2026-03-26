import fs from "node:fs";
import * as path from "path";

/**
 * Detect the framework type for an app by checking config files and package.json.
 */
export function detectFrameworkType(
  appPath: string,
): "nextjs" | "vite" | "other" | null {
  try {
    const nextConfigs = ["next.config.js", "next.config.mjs", "next.config.ts"];
    for (const config of nextConfigs) {
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
