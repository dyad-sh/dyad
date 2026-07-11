import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.E2E_TEST_BUILD = "true";
});

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { screen, waitFor } from "@testing-library/react";

import { readSettings, writeSettings } from "@/main/settings";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import type { ApproveProposalResult, ProposalResult } from "@/ipc/types";

interface SentEvent {
  channel: string;
  payload: unknown;
}

function makeEvent(sink: SentEvent[] = []) {
  const frame = { url: "http://localhost:5173/" };
  return {
    sender: {
      mainFrame: frame,
      isDestroyed: () => false,
      isCrashed: () => false,
      send: (channel: string, payload: unknown) =>
        sink.push({ channel, payload }),
    },
    senderFrame: frame,
  };
}

async function invoke<T = unknown>(
  channel: string,
  params?: unknown,
): Promise<T> {
  const handler = h.ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  const response = await handler(makeEvent(), params);
  return (
    isIpcInvokeEnvelope(response) ? unwrapIpcEnvelope(response) : response
  ) as T;
}

describe("supabase migrations (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      testBuild: true,
      settings: {
        isTestMode: true,
        autoApproveChanges: true,
        enableSupabaseWriteSqlMigration: false,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  async function sendPrompt(prompt: string) {
    const { send } = await harness.typeInChat(prompt);
    send();
    await harness.waitForStreamEnd(harness.chatId, 60_000);
    expect(
      harness.bridge.sentEvents.filter(
        (event) => event.channel === "chat:response:error",
      ),
    ).toHaveLength(0);
  }

  function migrationFiles() {
    const migrationsDir = path.join(harness.appDir, "supabase", "migrations");
    return fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir) : [];
  }

  function gitStatus() {
    return execFileSync("git", ["status", "--porcelain"], {
      cwd: harness.appDir,
      encoding: "utf8",
    }).trim();
  }

  it("writes Supabase SQL migration files only when enabled", async () => {
    harness.mount();
    await screen.findByTestId("chat-input-container");

    await sendPrompt("tc=add-supabase");
    await invoke("supabase:fake-connect-and-set-project", {
      appId: harness.appId,
      fakeProjectId: "fake-project-id",
    });

    await sendPrompt("tc=execute-sql-1");
    // Drain any work still in flight after chat:response:end before asserting
    // absence, so a late (buggy) migration write fails this check instead of
    // slipping past it.
    await harness.bridge.settleInFlight();
    expect(migrationFiles()).toHaveLength(0);

    writeSettings({ enableSupabaseWriteSqlMigration: true });
    expect(readSettings().enableSupabaseWriteSqlMigration).toBe(true);

    await sendPrompt("tc=execute-sql-1");
    await waitFor(() => expect(migrationFiles()).toHaveLength(1));

    let files = migrationFiles();
    expect(files[0]).toMatch(/0000_create_users_table\.sql/);
    expect(
      fs.readFileSync(
        path.join(harness.appDir, "supabase", "migrations", files[0]),
        "utf8",
      ),
    ).toBe("CREATE TABLE users (id serial primary key);");
    expect(gitStatus()).toBe("");

    await sendPrompt("tc=execute-sql-no-description");
    const proposalResult = await invoke<ProposalResult>("get-proposal", {
      chatId: harness.chatId,
    });
    expect(proposalResult?.proposal.type).toBe("code-proposal");
    if (proposalResult?.proposal.type !== "code-proposal") {
      throw new Error("Expected a code proposal");
    }
    expect(proposalResult.proposal.sqlQueries[0]).toEqual({
      content: "DROP TABLE users;",
      description: undefined,
    });
    const approvalResult = await invoke<ApproveProposalResult>(
      "approve-proposal",
      {
        chatId: harness.chatId,
        messageId: proposalResult.messageId,
      },
    );
    expect(approvalResult.success).toBe(true);
    await waitFor(() => expect(migrationFiles()).toHaveLength(2));

    files = migrationFiles();
    expect(files[1]).toMatch(/0001_\w+_\w+_\w+\.sql/);
    expect(
      fs.readFileSync(
        path.join(harness.appDir, "supabase", "migrations", files[1]),
        "utf8",
      ),
    ).toBe("DROP TABLE users;");
  }, 60_000);
});
