import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { syncEnvironmentFiles } from "./workspace_environment";

describe("syncEnvironmentFiles", () => {
  let root: string;
  let app: string;
  let worktree: string;

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dyad-env-"));
    app = path.join(root, "app");
    worktree = path.join(root, "worktree");
    await fs.promises.mkdir(app);
    await fs.promises.mkdir(worktree);
    execFileSync("git", ["init", "-q"], { cwd: app });
    execFileSync("git", ["init", "-q"], { cwd: worktree });
  });

  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  async function write(file: string, content: string, ageSeconds: number) {
    await fs.promises.writeFile(file, content);
    const time = new Date(Date.now() - ageSeconds * 1000);
    await fs.promises.utimes(file, time, time);
  }

  it("copies missing files and refreshes ones the app changed since", async () => {
    await write(path.join(app, ".env.local"), "KEY=new\n", 0);
    await write(path.join(worktree, ".env.local"), "KEY=old\n", 60);
    await write(path.join(app, ".env"), "BASE=1\n", 0);
    await write(path.join(app, "README.md"), "not an env file\n", 0);

    await syncEnvironmentFiles(app, worktree);

    expect(
      await fs.promises.readFile(path.join(worktree, ".env.local"), "utf8"),
    ).toBe("KEY=new\n");
    expect(
      await fs.promises.readFile(path.join(worktree, ".env"), "utf8"),
    ).toBe("BASE=1\n");
    expect(fs.existsSync(path.join(worktree, "README.md"))).toBe(false);
  });

  it("keeps a newer edit made inside the worktree", async () => {
    await write(path.join(app, ".env.local"), "KEY=app\n", 60);
    await write(path.join(worktree, ".env.local"), "KEY=agent\n", 0);

    await syncEnvironmentFiles(app, worktree);

    expect(
      await fs.promises.readFile(path.join(worktree, ".env.local"), "utf8"),
    ).toBe("KEY=agent\n");
  });

  it("leaves files Git tracks to arrive through Git", async () => {
    await write(path.join(worktree, ".env"), "TRACKED=committed\n", 60);
    execFileSync("git", ["add", ".env"], { cwd: worktree });
    // An uncommitted edit in the app's folder would otherwise be committed
    // by the chat's next turn.
    await write(path.join(app, ".env"), "TRACKED=uncommitted\n", 0);
    await write(path.join(app, ".env.local"), "LOCAL=1\n", 0);

    await syncEnvironmentFiles(app, worktree);

    expect(
      await fs.promises.readFile(path.join(worktree, ".env"), "utf8"),
    ).toBe("TRACKED=committed\n");
    expect(
      await fs.promises.readFile(path.join(worktree, ".env.local"), "utf8"),
    ).toBe("LOCAL=1\n");
  });

  it("leaves files the app's folder tracks or has staged", async () => {
    await write(path.join(app, ".env"), "STAGED=1\n", 0);
    execFileSync("git", ["add", ".env"], { cwd: app });
    await write(path.join(app, ".env.local"), "LOCAL=1\n", 0);

    await syncEnvironmentFiles(app, worktree);

    expect(fs.existsSync(path.join(worktree, ".env"))).toBe(false);
    expect(
      await fs.promises.readFile(path.join(worktree, ".env.local"), "utf8"),
    ).toBe("LOCAL=1\n");
  });

  it("copies nothing when Git cannot list tracked files", async () => {
    await fs.promises.rm(path.join(app, ".git"), {
      recursive: true,
      force: true,
    });
    await write(path.join(app, ".env.local"), "LOCAL=1\n", 0);

    await syncEnvironmentFiles(app, worktree);

    expect(fs.existsSync(path.join(worktree, ".env.local"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "never writes through a symlink in the worktree",
    async () => {
      const outside = path.join(root, "outside.txt");
      await write(outside, "OUTSIDE\n", 60);
      await fs.promises.symlink(outside, path.join(worktree, ".env.local"));
      await write(path.join(app, ".env.local"), "KEY=app\n", 0);

      await syncEnvironmentFiles(app, worktree);

      expect(await fs.promises.readFile(outside, "utf8")).toBe("OUTSIDE\n");
    },
  );
});
