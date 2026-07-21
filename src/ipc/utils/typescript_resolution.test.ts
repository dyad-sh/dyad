import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getTypeScriptCompilerPath,
  resolveTypeScriptPackageJsonPath,
  resolveTypeScriptPackageJsonPathSync,
} from "../../../shared/node_module_resolution";

const tempDirs: string[] = [];

async function writeTypeScriptTarget(
  rootPath: string,
  version: string,
): Promise<string> {
  const targetPath = path.join(rootPath, `typescript-${version}`);
  await fs.mkdir(targetPath, { recursive: true });
  await fs.writeFile(
    path.join(targetPath, "package.json"),
    JSON.stringify({ name: "typescript", version }),
  );
  return targetPath;
}

async function linkTypeScript(targetPath: string, linkPath: string) {
  await fs.symlink(
    process.platform === "win32" ? path.resolve(targetPath) : targetPath,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("TypeScript package resolution", () => {
  it("observes a pnpm-style symlink replacement in the same process", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-typescript-resolution-"),
    );
    tempDirs.push(appPath);
    const nodeModulesPath = path.join(appPath, "node_modules");
    await fs.mkdir(nodeModulesPath);
    const typeScript5Path = await writeTypeScriptTarget(appPath, "5.9.3");
    const typeScript7Path = await writeTypeScriptTarget(appPath, "7.0.2");
    const typeScriptLinkPath = path.join(nodeModulesPath, "typescript");
    await linkTypeScript(typeScript5Path, typeScriptLinkPath);

    const firstPackageJsonPath =
      await resolveTypeScriptPackageJsonPath(appPath);
    expect(await fs.realpath(firstPackageJsonPath)).toBe(
      await fs.realpath(path.join(typeScript5Path, "package.json")),
    );

    await fs.rm(typeScriptLinkPath, { recursive: true });
    await linkTypeScript(typeScript7Path, typeScriptLinkPath);

    const secondPackageJsonPath = resolveTypeScriptPackageJsonPathSync(appPath);
    expect(await fs.realpath(secondPackageJsonPath)).toBe(
      await fs.realpath(path.join(typeScript7Path, "package.json")),
    );
  });

  it("supports TypeScript hoisted above the app directory", async () => {
    const workspacePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-typescript-hoist-"),
    );
    tempDirs.push(workspacePath);
    const appPath = path.join(workspacePath, "packages", "web");
    const packageJsonPath = path.join(
      workspacePath,
      "node_modules",
      "typescript",
      "package.json",
    );
    await fs.mkdir(path.dirname(packageJsonPath), { recursive: true });
    await fs.mkdir(appPath, { recursive: true });
    await fs.writeFile(packageJsonPath, "{}");

    await expect(resolveTypeScriptPackageJsonPath(appPath)).resolves.toBe(
      packageJsonPath,
    );
  });

  it("uses the compiler entry declared by the package", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-typescript-main-"),
    );
    tempDirs.push(appPath);
    const packageJsonPath = path.join(
      appPath,
      "node_modules",
      "typescript",
      "package.json",
    );
    await fs.mkdir(path.dirname(packageJsonPath), { recursive: true });
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify({ main: "dist/compiler.cjs" }),
    );

    expect(getTypeScriptCompilerPath(packageJsonPath)).toBe(
      path.join(path.dirname(packageJsonPath), "dist", "compiler.cjs"),
    );
  });
});
