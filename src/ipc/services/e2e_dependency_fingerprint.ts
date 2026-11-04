import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { getPathEnvKey } from "../utils/path_env";
import type { IsolatedPackageManager } from "./isolated_package_install";

const INSTALL_FILES = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".node-version",
  ".nvmrc",
];
const INSTALL_HOOKS = [
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preprepare",
  "prepare",
  "postprepare",
];

/** Return null when installation has project-specific work that must run again. */
export async function e2eDependencyFingerprint({
  installPath,
  packagePaths,
  packageManager,
  env,
}: {
  installPath: string;
  packagePaths: readonly string[];
  packageManager: IsolatedPackageManager;
  env: NodeJS.ProcessEnv;
}): Promise<string | null> {
  const hash = createHash("sha256");
  const add = (value: unknown) => hash.update(JSON.stringify(value));
  add([
    "sandbox-dependencies-v1",
    packageManager,
    process.platform,
    process.arch,
  ]);
  // Hash, never persist, configuration/environment values (which can be secrets).
  add(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
  const lockfile =
    packageManager === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json";
  if (
    !(
      await fs.stat(path.join(installPath, lockfile)).catch(() => null)
    )?.isFile()
  )
    return null;
  for (const directory of [...new Set(packagePaths)].sort()) {
    const relative = path.relative(installPath, directory);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    const manifest = JSON.parse(
      await fs.readFile(path.join(directory, "package.json"), "utf8"),
    );
    // These hooks can generate files outside node_modules or migrate a fresh
    // test database. A dependency-cache hit must not skip their required work.
    if (INSTALL_HOOKS.some((hook) => manifest.scripts?.[hook])) return null;
    // Local packages, custom install hooks, and patching need more than a lockfile
    // to describe their inputs; retain the existing clean-install behavior.
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
    };
    if (
      Object.entries(dependencies).some(
        ([name, version]) =>
          name === "@prisma/client" ||
          (typeof version === "string" &&
            /^(file:|link:|\.\.?\/|\/)/.test(version)),
      ) ||
      manifest.pnpm?.patchedDependencies ||
      /(?:file:|link:)/.test(
        JSON.stringify([manifest.overrides, manifest.pnpm?.overrides]),
      )
    )
      return null;
    for (const config of [".pnpmfile.cjs", ".pnpmfile.mjs", "binding.gyp"])
      if (await fs.lstat(path.join(directory, config)).catch(() => null))
        return null;
    for (const file of INSTALL_FILES) {
      const contents = await fs
        .readFile(path.join(directory, file))
        .catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      add([relative, file, contents?.toString("base64") ?? null]);
      if (file === "pnpm-workspace.yaml" && contents) {
        const config = parseYaml(contents.toString());
        if (
          config?.patchedDependencies ||
          config?.pnpmfile ||
          config?.globalPnpmfile ||
          /(?:file:|link:)/.test(JSON.stringify(config?.overrides ?? {}))
        )
          return null;
      }
      if (
        file === ".npmrc" &&
        contents &&
        /(?:global-)?pnpmfile\s*=/i.test(contents.toString())
      )
        return null;
    }
  }
  // Include the actual executables selected by PATH: Electron's Node version
  // need not be the Node used by the package manager or native dependencies.
  const directories = (env[getPathEnvKey(env)] ?? "").split(path.delimiter);
  for (const tool of ["node", packageManager]) {
    let found = false;
    const names =
      process.platform === "win32"
        ? [tool === "node" ? "node.exe" : `${tool}.cmd`]
        : [tool];
    for (const directory of directories) {
      if (!path.isAbsolute(directory)) continue;
      for (const name of names) {
        const executable = await fs
          .realpath(path.join(directory, name))
          .catch(() => null);
        if (!executable) continue;
        const stat = await fs.stat(executable);
        if (!stat.isFile()) continue;
        add([tool, executable, stat.size, stat.mtimeMs, stat.ctimeMs]);
        found = true;
        break;
      }
      if (found) break;
    }
    if (!found) return null;
  }
  return hash.digest("hex");
}
