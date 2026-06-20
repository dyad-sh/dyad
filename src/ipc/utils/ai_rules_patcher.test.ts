import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NITRO_RULES_END,
  NITRO_RULES_START,
  appendNitroRules,
  restoreAiRules,
} from "./ai_rules_patcher";

describe("ai_rules_patcher", () => {
  let appPath: string;

  beforeEach(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-patcher-"));
  });

  afterEach(async () => {
    await fs.rm(appPath, { recursive: true, force: true });
  });

  async function readFile() {
    return fs.readFile(path.join(appPath, "AI_RULES.md"), "utf8");
  }

  it("creates AI_RULES.md when missing and appends the Nitro section", async () => {
    const result = await appendNitroRules(appPath);

    expect(result.wasAppended).toBe(true);
    expect(result.backup).toBeNull();

    const contents = await readFile();
    expect(contents).toContain(NITRO_RULES_START);
    expect(contents).toContain("## Nitro Server Layer");
    expect(contents).toContain(NITRO_RULES_END);
  });

  it("documents nitro/h3 as the import source for h3 utilities", async () => {
    await appendNitroRules(appPath);
    const contents = await readFile();

    expect(contents).toContain('"nitro/h3"');
    expect(contents).toContain("readBody");
    expect(contents).toContain("getRouterParam");
    expect(contents).toContain("createError");
    expect(contents).toMatch(/defineHandler[\s\S]*?"nitro"/);
  });

  it("includes a worked POST example using both nitro and nitro/h3", async () => {
    await appendNitroRules(appPath);
    const contents = await readFile();

    expect(contents).toContain('import { defineHandler } from "nitro"');
    expect(contents).toContain('from "nitro/h3"');
    expect(contents).toContain("todos.post.ts");
  });

  it("warns about installing server-side packages like @neondatabase/serverless", async () => {
    await appendNitroRules(appPath);
    const contents = await readFile();

    expect(contents).toContain("Server-side packages");
    expect(contents).toContain("@neondatabase/serverless");
    expect(contents).toContain("package.json");
  });

  it("lists the common mistakes the agent has been making", async () => {
    await appendNitroRules(appPath);
    const contents = await readFile();

    expect(contents).toContain("Common mistakes");
    expect(contents).toContain('readBody } from "nitro"');
    expect(contents).toContain('readBody } from "h3"');
    expect(contents).toMatch(/nitro\(\).*before.*react\(\)/i);
    expect(contents).toMatch(/Omitting `nitro\(\)` from `vite\.config\.ts`/);
  });

  it("preserves existing content above the Nitro markers", async () => {
    const original = "# My Project Rules\n\nUse TypeScript.\n";
    await fs.writeFile(path.join(appPath, "AI_RULES.md"), original, "utf8");

    const result = await appendNitroRules(appPath);

    expect(result.wasAppended).toBe(true);
    expect(result.backup).toBe(original);

    const contents = await readFile();
    expect(contents.startsWith(original)).toBe(true);
    expect(contents).toContain(NITRO_RULES_START);
  });

  it("is idempotent — running twice produces identical output", async () => {
    const original = "# Rules\n";
    await fs.writeFile(path.join(appPath, "AI_RULES.md"), original, "utf8");

    await appendNitroRules(appPath);
    const afterFirst = await readFile();

    const second = await appendNitroRules(appPath);
    const afterSecond = await readFile();

    expect(second.wasAppended).toBe(false);
    expect(afterSecond).toBe(afterFirst);
  });

  it("restoreAiRules rewrites the original contents when backup is non-null", async () => {
    const original = "# Keep me\n";
    await fs.writeFile(path.join(appPath, "AI_RULES.md"), original, "utf8");

    const { backup } = await appendNitroRules(appPath);
    await restoreAiRules(appPath, backup);

    const restored = await readFile();
    expect(restored).toBe(original);
  });

  it("restoreAiRules deletes the file when backup is null", async () => {
    await appendNitroRules(appPath);
    await restoreAiRules(appPath, null);

    await expect(readFile()).rejects.toMatchObject({ code: "ENOENT" });
  });
});
