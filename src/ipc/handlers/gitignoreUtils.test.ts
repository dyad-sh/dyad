import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureDyadGitignored } from "./gitignoreUtils";

const TEMP_BASE = path.join(os.tmpdir(), "dyad-gitignore-utils-tests");

async function readGitignore(appPath: string): Promise<string> {
  return fs.promises.readFile(path.join(appPath, ".gitignore"), "utf-8");
}

async function writeGitignore(appPath: string, content: string): Promise<void> {
  await fs.promises.writeFile(
    path.join(appPath, ".gitignore"),
    content,
    "utf-8",
  );
}

async function runOnce(initial: string | null): Promise<string> {
  const appPath = path.join(TEMP_BASE, "app");
  await fs.promises.mkdir(appPath, { recursive: true });
  if (initial === null) {
    fs.rmSync(path.join(appPath, ".gitignore"), { force: true });
  } else {
    await writeGitignore(appPath, initial);
  }
  await ensureDyadGitignored(appPath);
  return readGitignore(appPath);
}

async function runTwice(initial: string | null): Promise<string> {
  let result = await runOnce(initial);
  // Second invocation must be a no-op (idempotent) — it should not append
  // another `.dyad/` line.
  const appPath = path.join(TEMP_BASE, "app");
  await ensureDyadGitignored(appPath);
  const second = await readGitignore(appPath);
  expect(second).toBe(result);
  return second;
}

describe("ensureDyadGitignored", () => {
  beforeEach(() => {
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
    fs.mkdirSync(TEMP_BASE, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
  });

  describe("creates .gitignore when missing", () => {
    it("creates a .gitignore with .dyad/ when none exists", async () => {
      const result = await runOnce(null);
      expect(result).toBe(".dyad/\n");
    });

    it("idempotently creates only once when none exists", async () => {
      const result = await runTwice(null);
      expect(result).toBe(".dyad/\n");
    });
  });

  describe("appends when .dyad/ is genuinely absent", () => {
    it("appends .dyad/ to an unrelated .gitignore", async () => {
      const result = await runTwice("node_modules\n");
      expect(result).toBe("node_modules\n.dyad/\n");
    });

    it("adds a separating newline when content has no trailing newline", async () => {
      const result = await runOnce("node_modules");
      expect(result).toBe("node_modules\n.dyad/\n");
    });

    it("appends without adding a leading newline when content ends with newline", async () => {
      const result = await runOnce("node_modules\n.env\n");
      expect(result).toBe("node_modules\n.env\n.dyad/\n");
    });

    it("appends to an empty .gitignore", async () => {
      const result = await runTwice("");
      expect(result).toBe(".dyad/\n");
    });
  });

  describe("recognizes git-equivalent covering patterns (no append)", () => {
    it("treats the literal .dyad/ as covered", async () => {
      const result = await runTwice(".dyad/\n");
      expect(result).toBe(".dyad/\n");
    });

    it("treats .dyad (no trailing slash) as covered", async () => {
      const result = await runTwice(".dyad\n");
      expect(result).toBe(".dyad\n");
    });

    it("treats the anchored /.dyad/ as covered", async () => {
      const result = await runTwice("/.dyad/\n");
      expect(result).toBe("/.dyad/\n");
    });

    it("treats the anchored /.dyad (no slash) as covered", async () => {
      const result = await runTwice("/.dyad\n");
      expect(result).toBe("/.dyad\n");
    });

    it("treats the .dyad/* glob as covered", async () => {
      const result = await runTwice(".dyad/*\n");
      expect(result).toBe(".dyad/*\n");
    });

    it("treats the anchored /.dyad/* glob as covered", async () => {
      const result = await runTwice("/.dyad/*\n");
      expect(result).toBe("/.dyad/*\n");
    });

    it("treats the .dyad/** recursive glob as covered", async () => {
      const result = await runTwice(".dyad/**\n");
      expect(result).toBe(".dyad/**\n");
    });

    it("treats the anchored /.dyad/** glob as covered", async () => {
      const result = await runTwice("/.dyad/**\n");
      expect(result).toBe("/.dyad/**\n");
    });

    it("recognizes a covering pattern embedded among other entries", async () => {
      const initial = "node_modules\n/.dyad/\ndist\n";
      const result = await runTwice(initial);
      expect(result).toBe(initial);
    });

    it("ignores leading/trailing whitespace around a covering pattern", async () => {
      const result = await runTwice("  .dyad/  \n");
      expect(result).toBe("  .dyad/  \n");
    });
  });

  describe("does not falsely match unrelated patterns", () => {
    it("does not treat a comment mentioning .dyad/ as covered", async () => {
      const result = await runTwice("# .dyad/\n");
      expect(result).toBe("# .dyad/\n.dyad/\n");
    });

    it("does not treat a sibling directory like .dyad-backup/ as covered", async () => {
      const result = await runTwice(".dyad-backup/\n");
      expect(result).toBe(".dyad-backup/\n.dyad/\n");
    });

    it("does not treat a partial glob like .dyad/*.log as covered", async () => {
      const result = await runTwice(".dyad/*.log\n");
      expect(result).toBe(".dyad/*.log\n.dyad/\n");
    });

    it("does not treat a nested path like .dyad/sub/ as covered", async () => {
      const result = await runTwice(".dyad/sub/\n");
      expect(result).toBe(".dyad/sub/\n.dyad/\n");
    });

    it("does not treat a glob of subdirs like .dyad/*/ as covered", async () => {
      const result = await runTwice(".dyad/*/\n");
      expect(result).toBe(".dyad/*/\n.dyad/\n");
    });
  });

  describe("never overrides a selective un-ignore (negation)", () => {
    it("preserves the .dyad/* + !.dyad/<file> idiom unchanged", async () => {
      const initial = ".dyad/*\n!.dyad/global-rules.md\n";
      const result = await runTwice(initial);
      expect(result).toBe(initial);
    });

    it("preserves the anchored /.dyad/* + !.dyad/<file> idiom", async () => {
      const initial = "/.dyad/*\n!/.dyad/global-rules.md\n";
      const result = await runTwice(initial);
      expect(result).toBe(initial);
    });

    it("does not append when a bare !.dyad/<file> negation is present", async () => {
      const initial = "!.dyad/global-rules.md\n";
      const result = await runTwice(initial);
      expect(result).toBe(initial);
    });

    it("does not append when a !.dyad/ directory negation is present", async () => {
      const initial = "!.dyad/\n";
      const result = await runTwice(initial);
      expect(result).toBe(initial);
    });

    it("does not append when a !.dyad negation is present", async () => {
      const initial = "!.dyad\n";
      const result = await runTwice(initial);
      expect(result).toBe(initial);
    });

    it("does not append even when .dyad/ is genuinely absent and a negation exists", async () => {
      // A negation targeting .dyad/ signals user intent over the directory;
      // appending .dyad/ would exclude the parent and defeat the un-ignore.
      const initial = "*.log\n!.dyad/keep.txt\n";
      const result = await runTwice(initial);
      expect(result).toBe(initial);
    });

    it("ignores unrelated negations and still appends", async () => {
      const result = await runTwice("*.log\n!important.log\n");
      expect(result).toBe("*.log\n!important.log\n.dyad/\n");
    });
  });

  describe("line endings", () => {
    it("handles CRLF line endings when a covering pattern is present", async () => {
      const initial = "node_modules\r\n/.dyad/\r\n";
      const result = await runTwice(initial);
      expect(result).toBe(initial);
    });

    it("handles CRLF line endings when appending", async () => {
      const result = await runOnce("node_modules\r\n");
      expect(result).toBe("node_modules\r\n.dyad/\n");
    });
  });
});
