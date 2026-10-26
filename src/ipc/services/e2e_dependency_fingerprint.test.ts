import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { e2eDependencyFingerprint } from "./e2e_dependency_fingerprint";

let root: string;
let installPath: string;
let bin: string;
let env: NodeJS.ProcessEnv;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-dependency-key-"));
  installPath = path.join(root, "app");
  bin = path.join(root, "bin");
  await fs.mkdir(installPath);
  await fs.mkdir(bin);
  for (const tool of ["node", "npm", "pnpm"])
    await fs.writeFile(
      path.join(
        bin,
        process.platform === "win32"
          ? tool === "node"
            ? "node.exe"
            : `${tool}.cmd`
          : tool,
      ),
      "tool v1",
    );
  env = { PATH: bin };
  await fs.writeFile(
    path.join(installPath, "package.json"),
    '{"private":true}',
  );
  await fs.writeFile(path.join(installPath, "package-lock.json"), "{}");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
const fingerprint = (packagePaths = [installPath]) =>
  e2eDependencyFingerprint({
    installPath,
    packagePaths,
    packageManager: "npm",
    env,
  });

it("keeps the same key for source edits and changes it for package, config, or runtime changes", async () => {
  let previous = await fingerprint();
  expect(previous).toMatch(/^[a-f0-9]{64}$/);
  await fs.writeFile(path.join(installPath, "app.ts"), "source-only edit");
  expect(await fingerprint()).toBe(previous);
  for (const [file, value] of [
    ["package.json", '{"dependencies":{"example":"2.0.0"}}'],
    ["package-lock.json", '{"version":2}'],
    [".npmrc", "audit=false"],
  ]) {
    await fs.writeFile(path.join(installPath, file), value);
    const next = await fingerprint();
    expect(next).not.toBeNull();
    expect(next).not.toBe(previous);
    previous = next;
  }
  await fs.writeFile(
    path.join(bin, process.platform === "win32" ? "node.exe" : "node"),
    "tool version 2",
  );
  expect(await fingerprint()).not.toBe(previous);
});

it("includes workspace-member manifests and install environment", async () => {
  const member = path.join(installPath, "member");
  await fs.mkdir(member);
  await fs.writeFile(path.join(member, "package.json"), '{"name":"member"}');
  const previous = await fingerprint([installPath, member]);
  await fs.writeFile(
    path.join(member, "package.json"),
    '{"name":"member","version":"2.0.0"}',
  );
  const changed = await fingerprint([installPath, member]);
  expect(changed).not.toBeNull();
  expect(changed).not.toBe(previous);
  env.NODE_ENV = "production";
  expect(await fingerprint([installPath, member])).not.toBe(changed);
});

it.each([
  { scripts: { postinstall: "node setup.js" } },
  { scripts: { prepare: "node generate.js" } },
  { dependencies: { local: "file:../local" } },
  { dependencies: { "@prisma/client": "1.0.0" } },
  { pnpm: { patchedDependencies: { example: "patches/example.patch" } } },
])("requires installation for project-specific setup: %j", async (manifest) => {
  await fs.writeFile(
    path.join(installPath, "package.json"),
    JSON.stringify(manifest),
  );
  expect(await fingerprint()).toBeNull();
});

it("does not cache without a lockfile or discoverable runtime", async () => {
  env.PATH = "";
  expect(await fingerprint()).toBeNull();
  env.PATH = bin;
  await fs.rm(path.join(installPath, "package-lock.json"));
  expect(await fingerprint()).toBeNull();
});

it("handles pnpm and refuses workspace patches and native root builds", async () => {
  await fs.writeFile(
    path.join(installPath, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'",
  );
  const pnpmFingerprint = () =>
    e2eDependencyFingerprint({
      installPath,
      packagePaths: [installPath],
      packageManager: "pnpm",
      env,
    });
  expect(await pnpmFingerprint()).toMatch(/^[a-f0-9]{64}$/);
  await fs.writeFile(
    path.join(installPath, "pnpm-workspace.yaml"),
    "patchedDependencies:\n  example: patches/example.patch\n",
  );
  expect(await pnpmFingerprint()).toBeNull();
  await fs.rm(path.join(installPath, "pnpm-workspace.yaml"));
  await fs.writeFile(path.join(installPath, "binding.gyp"), "{}");
  expect(await pnpmFingerprint()).toBeNull();
});
