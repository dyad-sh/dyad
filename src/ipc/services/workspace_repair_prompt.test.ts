import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "@/testing/test_db";

const h = vi.hoisted(() => ({ db: {} as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return h.db;
  },
}));

import { apps, chats, messages } from "@/db/schema";
import { createInMemoryTestDb } from "@/testing/test_db";
import {
  buildConflictDiffSections,
  buildWorkspaceRepairPrompt,
  WORKSPACE_REPAIR_PROMPT_PREFIX,
} from "./workspace_repair_prompt";

describe("buildConflictDiffSections", () => {
  it("keeps every file's diffs within the total budget", async () => {
    const files = Array.from(
      { length: 8 },
      (_, index) => `src/file${index}.ts`,
    );
    const readDiffs = vi.fn(async (file: string) => ({
      ours: `+ours ${file}\n`.repeat(1_000),
      theirs: `+theirs ${file}\n`.repeat(1_000),
    }));

    const sections = await buildConflictDiffSections({
      files,
      targetBranch: "main",
      label: (file) => file,
      readDiffs,
    });

    const note = sections.at(-1)!;
    const diffSections = sections.slice(0, -1);
    expect(diffSections.join("").length).toBeLessThanOrEqual(20_000);
    // Each shown section still closes its code blocks.
    for (const section of diffSections) {
      expect(section.endsWith("```")).toBe(true);
      expect(section.match(/```/g)).toHaveLength(4);
    }
    // Files that did not fit are named, and their diffs are never read.
    expect(note).toContain("src/file7.ts");
    expect(note).toContain("read those files directly");
    expect(readDiffs.mock.calls.map(([file]) => file)).toEqual(
      files.slice(0, diffSections.length),
    );
  });

  it("says when Git could not produce a side's diff", async () => {
    const [section] = await buildConflictDiffSections({
      files: ["src/a.ts"],
      targetBranch: "main",
      label: (file) => file,
      readDiffs: async () => ({ ours: null, theirs: "" }),
    });

    expect(section).toContain(
      "This chat's change:\n```diff\n(diff unavailable: Git could not compute it; read the file directly)\n```",
    );
    expect(section).toContain("Change already on main:\n```diff\n(no change)");
  });
});

describe("buildWorkspaceRepairPrompt", () => {
  let root: string;
  let testDb: TestDb;

  function git(...args: string[]): string {
    return execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    )
      .toString()
      .trim();
  }

  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "dyad-repair-prompt-")),
    );
    testDb = createInMemoryTestDb();
    h.db = testDb;
  });

  afterEach(async () => {
    testDb.$client.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reports another chat's request, not the repair prompt before its turn", async () => {
    git("init", "-q", "-b", "main");
    await fs.writeFile(path.join(root, "a.txt"), "base\n");
    git("add", ".");
    git("commit", "-q", "-m", "initial");
    git("checkout", "-q", "-b", "dyad/chat-1");
    await fs.writeFile(path.join(root, "a.txt"), "ours\n");
    git("commit", "-q", "-am", "chat change");
    git("checkout", "-q", "main");
    await fs.writeFile(path.join(root, "a.txt"), "theirs\n");
    git("commit", "-q", "-am", "dark mode");
    const targetCommit = git("rev-parse", "HEAD");
    git("checkout", "-q", "dyad/chat-1");
    expect(() => git("merge", "main")).toThrow();

    const appId = testDb
      .insert(apps)
      .values({ name: "App", path: root })
      .returning({ id: apps.id })
      .get().id;
    const repairingChatId = testDb
      .insert(chats)
      .values({ appId, title: "Repairing" })
      .returning({ id: chats.id })
      .get().id;
    const otherChatId = testDb
      .insert(chats)
      .values({ appId, title: "Dark mode chat" })
      .returning({ id: chats.id })
      .get().id;
    testDb
      .insert(messages)
      .values([
        { chatId: otherChatId, role: "user", content: "Add dark mode" },
        { chatId: otherChatId, role: "assistant", content: "Done." },
        {
          chatId: otherChatId,
          role: "user",
          content: `${WORKSPACE_REPAIR_PROMPT_PREFIX} on \`main\`.`,
        },
        {
          chatId: otherChatId,
          role: "assistant",
          content: "Resolved.",
          commitHash: targetCommit,
        },
      ])
      .run();

    const prompt = await buildWorkspaceRepairPrompt({
      chatId: repairingChatId,
      repositoryPath: root,
      appSubpath: "",
      workspaceBranch: "dyad/chat-1",
      targetBranch: "main",
      conflictedFiles: ["a.txt"],
      attempt: 1,
    });

    expect(prompt).toContain('- Chat "Dark mode chat" asked: Add dark mode');
    expect(prompt).not.toContain(`asked: ${WORKSPACE_REPAIR_PROMPT_PREFIX}`);
  });
});
