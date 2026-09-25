import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => userDataDir,
}));

let userDataDir = "";

import {
  buildGuestInvocation,
  fromGuestPath,
  GUEST_BASE_ENV,
  resolveGitMask,
  toGuestPath,
  type GuestInvocationInput,
} from "./guest_command";

function baseInput(
  overrides: Partial<GuestInvocationInput> = {},
): GuestInvocationInput {
  return {
    appId: 7,
    hostRoot: "/Users/me/dyad-apps/my-app",
    cwd: "/Users/me/dyad-apps/my-app",
    command: "pnpm",
    args: ["run", "build"],
    nodeModules: "app-volume",
    image: "base",
    gitMask: {
      kind: "directory",
      guestPath: "/Users/me/dyad-apps/my-app/.git",
    },
    ...overrides,
  };
}

function valuesAfter(args: string[], flag: string): string[] {
  return args.flatMap((arg, index) =>
    arg === flag && index + 1 < args.length ? [args[index + 1]] : [],
  );
}

describe("toGuestPath / fromGuestPath", () => {
  it("mounts POSIX paths at the identical guest path", () => {
    expect(toGuestPath("/Users/me/app", "darwin")).toBe("/Users/me/app");
    expect(toGuestPath("/home/me/app/", "linux")).toBe("/home/me/app/");
    expect(fromGuestPath("/Users/me/app/src/a.ts", "darwin")).toBe(
      "/Users/me/app/src/a.ts",
    );
  });

  it("maps Windows drive paths under /host and back", () => {
    expect(toGuestPath("C:\\Users\\me\\app", "win32")).toBe(
      "/host/c/Users/me/app",
    );
    expect(fromGuestPath("/host/c/Users/me/app/src/a.ts", "win32")).toBe(
      "C:\\Users\\me\\app\\src\\a.ts",
    );
    expect(fromGuestPath("/usr/lib/node", "win32")).toBe("/usr/lib/node");
  });
});

describe("buildGuestInvocation", () => {
  it("runs the command in a throwaway, labeled container of the given image", () => {
    const invocation = buildGuestInvocation(baseInput(), "dyad-runtime:abc");
    const { args } = invocation;

    expect(invocation.command).toBe("docker");
    expect(args.slice(0, 3)).toEqual(["run", "--rm", "--init"]);
    expect(invocation.containerName).toMatch(/^dyad-job-7-/);
    expect(valuesAfter(args, "--name")).toEqual([invocation.containerName]);
    expect(valuesAfter(args, "--label")).toEqual(
      expect.arrayContaining([
        "dyad.managed=1",
        "dyad.role=job",
        "dyad.app-id=7",
      ]),
    );
    const imageIndex = args.indexOf("dyad-runtime:abc");
    expect(args.slice(imageIndex)).toEqual([
      "dyad-runtime:abc",
      "pnpm",
      "run",
      "build",
    ]);
    expect(valuesAfter(args, "-w")).toEqual(["/Users/me/dyad-apps/my-app"]);
  });

  it("mounts only the app, its node_modules volume, the browser cache, and hides .git", () => {
    const { args } = buildGuestInvocation(baseInput(), "img");
    expect(valuesAfter(args, "--mount")).toEqual([
      "type=bind,source=/Users/me/dyad-apps/my-app,target=/Users/me/dyad-apps/my-app",
      "type=volume,source=dyad-nm-7,target=/Users/me/dyad-apps/my-app/node_modules",
      "type=tmpfs,target=/Users/me/dyad-apps/my-app/.git",
      "type=volume,source=dyad-playwright-browsers,target=/ms-playwright",
    ]);
    expect(args).not.toContain("-v");
  });

  it("masks a .git file (worktree pointer) with a read-only empty file", () => {
    const { args } = buildGuestInvocation(
      baseInput({
        gitMask: {
          kind: "file",
          guestPath: "/Users/me/dyad-apps/my-app/.git",
          emptyFileHostPath: "/data/empty",
        },
      }),
      "img",
    );
    expect(valuesAfter(args, "--mount")).toContain(
      "type=bind,source=/data/empty,target=/Users/me/dyad-apps/my-app/.git,readonly",
    );
  });

  it("keeps a snapshot's dependencies in-tree and shares only the app's store", () => {
    const { args } = buildGuestInvocation(
      baseInput({
        hostRoot: "/data/snapshots/7-abc",
        cwd: "/data/snapshots/7-abc/app",
        nodeModules: "in-tree",
        gitMask: { kind: "none" },
      }),
      "img",
    );
    const mounts = valuesAfter(args, "--mount");
    expect(mounts).toContain(
      "type=volume,source=dyad-nm-7,target=/dyad-app-deps",
    );
    expect(mounts.some((mount) => mount.includes("node_modules"))).toBe(false);
    expect(valuesAfter(args, "-e")).toEqual(
      expect.arrayContaining([
        "npm_config_store_dir=/dyad-app-deps/.pnpm-store",
        "pnpm_config_store_dir=/dyad-app-deps/.pnpm-store",
      ]),
    );
    expect(valuesAfter(args, "-w")).toEqual(["/data/snapshots/7-abc/app"]);
  });

  it("never forwards the host environment, and passes caller values by name only", () => {
    const hostEnv = {
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-host-secret",
      HOME: "/Users/me",
    };
    const invocation = buildGuestInvocation(
      baseInput({
        env: { DATABASE_URL: "postgres://secret", UNSET: undefined },
      }),
      "img",
      hostEnv,
    );
    const envArgs = valuesAfter(invocation.args, "-e");
    for (const [key, value] of Object.entries(GUEST_BASE_ENV)) {
      expect(envArgs).toContain(`${key}=${value}`);
    }
    expect(envArgs).toContain("DATABASE_URL");
    expect(invocation.args.join(" ")).not.toContain("postgres://secret");
    expect(envArgs.some((arg) => arg.startsWith("OPENAI_API_KEY"))).toBe(false);
    expect(envArgs.some((arg) => arg.startsWith("UNSET"))).toBe(false);
    // The Docker CLI itself still needs the host environment to find the daemon.
    expect(invocation.clientEnv.PATH).toBe("/usr/bin");
    expect(invocation.clientEnv.DATABASE_URL).toBe("postgres://secret");
  });

  it("attaches stdin only for interactive commands", () => {
    expect(buildGuestInvocation(baseInput(), "img").args).not.toContain("-i");
    const { args } = buildGuestInvocation(
      baseInput({ interactive: true }),
      "img",
    );
    expect(args.slice(0, 4)).toEqual(["run", "--rm", "--init", "-i"]);
  });

  it("does not set CI, which would make pnpm installs frozen-lockfile", () => {
    const envArgs = valuesAfter(
      buildGuestInvocation(baseInput(), "img").args,
      "-e",
    );
    expect(envArgs.some((arg) => arg === "CI" || arg.startsWith("CI="))).toBe(
      false,
    );
  });

  it("rejects environment names that could inject Docker flags", () => {
    expect(() =>
      buildGuestInvocation(
        baseInput({ env: { "A=B --privileged": "x" } }),
        "img",
      ),
    ).toThrow(/Invalid environment variable name/);
  });

  it("refuses a working directory outside the mounted root", () => {
    expect(() =>
      buildGuestInvocation(baseInput({ cwd: "/Users/me/elsewhere" }), "img"),
    ).toThrow(/outside the Docker runtime mount/);
  });

  it("joins the dev server's network or publishes ports, never both implicitly", () => {
    const joined = buildGuestInvocation(
      baseInput({ joinNetworkOf: "dyad-app-7" }),
      "img",
    ).args;
    expect(valuesAfter(joined, "--network")).toEqual(["container:dyad-app-7"]);
    expect(joined).not.toContain("--add-host");

    const devServer = buildGuestInvocation(
      baseInput({
        publishPorts: [32107],
        containerName: "dyad-app-7",
        role: "app",
      }),
      "img",
    ).args;
    expect(valuesAfter(devServer, "-p")).toEqual(["32107:32107"]);
    expect(valuesAfter(devServer, "--name")).toEqual(["dyad-app-7"]);
    expect(valuesAfter(devServer, "--label")).toContain("dyad.role=app");
  });
});

describe("resolveGitMask", () => {
  let appDir = "";

  beforeEach(() => {
    appDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-git-mask-"));
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-user-data-"));
  });

  afterEach(() => {
    fs.rmSync(appDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it("returns none when the directory has no .git", async () => {
    expect(await resolveGitMask(appDir)).toEqual({ kind: "none" });
  });

  it("masks a .git directory with tmpfs", async () => {
    fs.mkdirSync(path.join(appDir, ".git"));
    expect(await resolveGitMask(appDir)).toEqual({
      kind: "directory",
      guestPath: toGuestPath(path.join(appDir, ".git")),
    });
  });

  it("masks a .git file with an empty Dyad-owned file", async () => {
    fs.writeFileSync(path.join(appDir, ".git"), "gitdir: /elsewhere\n");
    const mask = await resolveGitMask(appDir);
    expect(mask.kind).toBe("file");
    if (mask.kind !== "file") return;
    expect(mask.emptyFileHostPath.startsWith(userDataDir)).toBe(true);
    expect(fs.readFileSync(mask.emptyFileHostPath, "utf8")).toBe("");
  });
});
