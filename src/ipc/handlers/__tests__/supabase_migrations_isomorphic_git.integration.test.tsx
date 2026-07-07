import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.E2E_TEST_BUILD = "true";
});

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

function makeEvent() {
  return {
    sender: {
      isDestroyed: () => false,
      isCrashed: () => false,
      send: () => {},
    },
  };
}

// The migration file must also be committed on the isomorphic-git path
// (enableNativeGit: false), which has its own commit implementation — see
// issue #608. Own file per the one-harness-per-file convention.
describe("supabase migrations with isomorphic git (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      testBuild: true,
      enableNativeGit: false,
      settings: {
        isTestMode: true,
        autoApproveChanges: true,
        enableSupabaseWriteSqlMigration: true,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("writes and commits the migration file", async () => {
    harness.mount();
    await screen.findByTestId("chat-input-container");

    const sendPrompt = async (prompt: string) => {
      const { send } = await harness.typeInChat(prompt);
      send();
      await harness.waitForStreamEnd(harness.chatId, 60_000);
    };
    const migrationsDir = path.join(harness.appDir, "supabase", "migrations");

    await sendPrompt("tc=add-supabase");
    const handler = h.ipcHandlers.get("supabase:fake-connect-and-set-project");
    if (!handler) {
      throw new Error("supabase:fake-connect-and-set-project not registered");
    }
    await handler(makeEvent(), {
      appId: harness.appId,
      fakeProjectId: "fake-project-id",
    });

    await sendPrompt("tc=execute-sql-1");
    await waitFor(() => {
      expect(fs.readdirSync(migrationsDir)).toHaveLength(1);
    });
    const [file] = fs.readdirSync(migrationsDir);
    expect(file).toMatch(/0000_create_users_table\.sql/);
    expect(fs.readFileSync(path.join(migrationsDir, file), "utf8")).toBe(
      "CREATE TABLE users (id serial primary key);",
    );
    // Committed, not just written: the working tree must be clean.
    expect(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: harness.appDir,
        encoding: "utf8",
      }).trim(),
    ).toBe("");
  }, 60_000);
});
