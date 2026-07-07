// @vitest-environment node
//
// Migrated from e2e-tests/supabase_migrations.spec.ts ("supabase migrations"
// and "supabase migrations with native git").
//
// Both e2e tests ran with the same settings — the e2e default is native git
// ON (settings default enableNativeGit: true; the second test passed
// disableNativeGit: false purely for documentation) — and differ only in the
// second test's `git status --porcelain` cleanliness assertion (regression
// check for https://github.com/dyad-sh/dyad/issues/608). One sequence here
// covers the union of both tests' behavior:
//
//  - SCENARIO 1 (off by default): a dyad-execute-sql response does NOT write
//    supabase/migrations files;
//  - SCENARIO 2 (toggled on via the enableSupabaseWriteSqlMigration setting —
//    what the "Write SQL migration files" switch persists):
//      * execute-sql with a description writes 0000_create_users_table.sql
//        with the exact SQL, and the git tree stays clean (native git);
//      * execute-sql WITHOUT a description contains destructive SQL, so it is
//        NOT auto-approved; approving the proposal (approve-proposal handler,
//        the e2e's approve button) writes 0001_<cute_app_name>.sql.
//
// Dropped as UI-only: settings-page navigation and switch/checked states.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  // Enables the test-only supabase:fake-connect-and-set-project handler and
  // the mock Supabase management client (executeSupabaseSql is a no-op mock,
  // same as the Playwright suite).
  process.env.E2E_TEST_BUILD = "true";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { registerSupabaseHandlers } from "@/ipc/handlers/supabase_handlers";
import { registerProposalHandlers } from "@/ipc/handlers/proposal_handlers";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { readSettings, writeSettings } from "@/main/settings";

function makeEvent() {
  return {
    sender: {
      isDestroyed: () => false,
      isCrashed: () => false,
      send: () => {},
    },
  };
}

async function invoke(channel: string, params?: unknown): Promise<any> {
  const handler = h.ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  const response = await handler(makeEvent(), params);
  return isIpcInvokeEnvelope(response) ? unwrapIpcEnvelope(response) : response;
}

describe("supabase migrations (integration)", () => {
  let harness: ChatFlowHarness;
  let migrationsDir: string;

  beforeAll(async () => {
    // Native git on — the e2e default (both spec variants ran with it).
    harness = await setupChatFlowHarness({
      electronMock: h,
      enableNativeGit: true,
    });
    registerSupabaseHandlers();
    registerProposalHandlers();
    migrationsDir = path.join(harness.appDir, "supabase", "migrations");

    // Connect Supabase (the connect button's test path).
    await invoke("supabase:fake-connect-and-set-project", {
      appId: harness.appId,
      fakeProjectId: "fake-project-id",
    });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("does not write migration files when the setting is off (default)", async () => {
    expect(readSettings().enableSupabaseWriteSqlMigration).toBeFalsy();

    const { result, messages } = await harness.streamChat("tc=execute-sql-1");
    expect(result).toBe(harness.chatId);
    // Auto-approved (non-destructive SQL) — executed, but no migration file.
    const assistant = messages.filter((m) => m.role === "assistant").at(-1)!;
    expect(assistant.approvalState).toBe("approved");

    expect(fs.existsSync(migrationsDir)).toBe(false);
  }, 30_000);

  it("writes a migration file when the setting is on, leaving git clean", async () => {
    // The "Write SQL migration files" switch persists this setting.
    writeSettings({ enableSupabaseWriteSqlMigration: true });
    expect(readSettings().enableSupabaseWriteSqlMigration).toBe(true);

    const { result } = await harness.streamChat("tc=execute-sql-1");
    expect(result).toBe(harness.chatId);

    const files = fs.readdirSync(migrationsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/0000_create_users_table\.sql/);
    expect(fs.readFileSync(path.join(migrationsDir, files[0]), "utf8")).toEqual(
      "CREATE TABLE users (id serial primary key);",
    );

    // Make sure git is clean (issue #608: the migration file must be part of
    // the commit, not left dangling in the working tree).
    const gitStatus = execFileSync("git", ["status", "--porcelain"], {
      cwd: harness.appDir,
      encoding: "utf8",
    }).trim();
    expect(gitStatus).toBe("");
  }, 30_000);

  it("writes a generated-name migration file after manual approval when the SQL has no description", async () => {
    // Destructive SQL (DROP TABLE) is never auto-approved, even with
    // auto-approve on — the e2e clicked the approve button.
    const { result, messages } = await harness.streamChat(
      "tc=execute-sql-no-description",
    );
    expect(result).toBe(harness.chatId);

    const assistant = messages.filter((m) => m.role === "assistant").at(-1)!;
    expect(assistant.approvalState).not.toBe("approved");

    const approveResult = await invoke("approve-proposal", {
      chatId: harness.chatId,
      messageId: assistant.id,
    });
    expect(approveResult.success).toBe(true);

    const files = fs.readdirSync(migrationsDir).sort();
    expect(files).toHaveLength(2);
    expect(files[1]).toMatch(/0001_\w+_\w+_\w+\.sql/);
    expect(fs.readFileSync(path.join(migrationsDir, files[1]), "utf8")).toEqual(
      "DROP TABLE users;",
    );
  }, 30_000);
});
