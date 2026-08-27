// Migrated from e2e-tests/retry.spec.ts, then converted from the node chat-flow
// harness to the HYBRID harness. This is the maximum-fidelity conversion: after
// the first response renders, it finds the REAL "Retry" button in the rendered
// message list and clicks it (MessagesList.tsx), instead of invoking
// chat:stream with redo=true directly.
//
// The Retry button re-streams the last user prompt with `redo: true`, which
// makes chat:stream delete the most recent user+assistant pair before streaming
// again. The fake server's "[increment]" prompt returns a monotonic counter, so
// a successful retry replaces "counter=1" with "counter=2" instead of appending
// a new message pair.
//
// Fidelity note: with only one turn on the chat, `versions` (loaded once on
// mount) holds just the fixture's initial commit, so the Retry handler's
// `versions[0].oid === lastMessage.commitHash` check is false and it takes the
// plain `redo: true` path — the exact behavior the node test invoked directly.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

function commitWithTestIdentity(cwd: string, message: string) {
  execFileSync(
    "git",
    [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test User",
      "commit",
      "-m",
      message,
    ],
    { cwd },
  );
}

async function waitForCleanGit(harness: HybridChatHarness) {
  await harness.bridge.settleInFlight();
  const cwd = harness.appDir;
  await waitFor(
    () => {
      expect(fs.existsSync(path.join(cwd, ".git", "index.lock"))).toBe(false);
      expect(
        execFileSync("git", ["status", "--porcelain"], { cwd }).toString(),
      ).toBe("");
    },
    { timeout: 15_000 },
  );
}

describe("retry (hybrid)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("preserves commits from before the response and confirms before reverting newer commits", async () => {
    harness.mount();
    await waitFor(
      () => expect(screen.getByTestId("chat-input-container")).toBeTruthy(),
      { timeout: 15_000 },
    );

    const sendTurn = async (prompt: string) => {
      const end = harness.waitForNextStreamEnd(harness.chatId);
      const { send } = await harness.typeInChat(prompt);
      send();
      await end;
    };

    await sendTurn("tc=local-agent/write-index");
    await waitForCleanGit(harness);
    const earlierManualPath = path.join(
      harness.appDir,
      "retry-earlier-manual-change.txt",
    );
    fs.writeFileSync(earlierManualPath, "keep me\n");
    execFileSync("git", ["add", "retry-earlier-manual-change.txt"], {
      cwd: harness.appDir,
    });
    commitWithTestIdentity(harness.appDir, "Manual work before latest AI turn");
    await sendTurn("tc=local-agent/write-index-2");
    await waitForCleanGit(harness);

    const directRetryEnd = harness.waitForNextStreamEnd(harness.chatId);
    fireEvent.click(await screen.findByRole("button", { name: /Retry/ }));
    expect(screen.queryByTestId("extra-commits-revert-dialog")).toBeNull();
    await directRetryEnd;
    await waitForCleanGit(harness);
    expect(fs.existsSync(earlierManualPath)).toBe(true);

    const newerManualPath = path.join(
      harness.appDir,
      "retry-newer-manual-change.txt",
    );
    fs.writeFileSync(newerManualPath, "choose what happens to me\n");
    execFileSync("git", ["add", "retry-newer-manual-change.txt"], {
      cwd: harness.appDir,
    });
    commitWithTestIdentity(harness.appDir, "Manual work after latest AI turn");

    const messagesBefore = await harness.db.query.messages.findMany();
    const retryButton = await screen.findByRole("button", { name: /Retry/ });
    fireEvent.click(retryButton);

    expect(
      await screen.findByTestId("extra-commits-revert-dialog"),
    ).toBeTruthy();
    expect(screen.getByText("Manual work after latest AI turn")).toBeTruthy();
    expect(screen.getByTestId("retry-from-current-code-button")).toBeTruthy();
    fireEvent.click(screen.getByTestId("cancel-revert-button"));
    await waitFor(() =>
      expect(screen.queryByTestId("extra-commits-revert-dialog")).toBeNull(),
    );
    expect(fs.existsSync(newerManualPath)).toBe(true);
    expect(await harness.db.query.messages.findMany()).toHaveLength(
      messagesBefore.length,
    );

    const retriedStreamEnd = harness.waitForNextStreamEnd(harness.chatId);
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    fireEvent.click(await screen.findByTestId("confirm-revert-anyway-button"));
    await retriedStreamEnd;
    await waitForCleanGit(harness);

    expect(fs.existsSync(newerManualPath)).toBe(false);
    expect(fs.existsSync(earlierManualPath)).toBe(true);
    await waitFor(() =>
      expect(screen.queryByTestId("extra-commits-revert-dialog")).toBeNull(),
    );
  }, 60_000);

  it("can retry from current code without reverting newer commits", async () => {
    harness.mount();
    await waitFor(
      () => expect(screen.getByTestId("chat-input-container")).toBeTruthy(),
      { timeout: 15_000 },
    );

    const end = harness.waitForNextStreamEnd(harness.chatId);
    const { send } = await harness.typeInChat("tc=local-agent/write-index");
    send();
    await end;
    await waitForCleanGit(harness);

    const manualPath = path.join(
      harness.appDir,
      "retry-current-code-change.txt",
    );
    fs.writeFileSync(manualPath, "keep current code\n");
    execFileSync("git", ["add", "retry-current-code-change.txt"], {
      cwd: harness.appDir,
    });
    commitWithTestIdentity(harness.appDir, "Newer work to preserve");

    fireEvent.click(await screen.findByRole("button", { name: /Retry/ }));
    expect(
      await screen.findByTestId("extra-commits-revert-dialog"),
    ).toBeTruthy();
    expect(screen.getByText("Newer work to preserve")).toBeTruthy();

    const retryEnd = harness.waitForNextStreamEnd(harness.chatId);
    fireEvent.click(screen.getByTestId("retry-from-current-code-button"));
    await retryEnd;
    await waitForCleanGit(harness);

    expect(fs.existsSync(manualPath)).toBe(true);
    await waitFor(() =>
      expect(screen.queryByTestId("extra-commits-revert-dialog")).toBeNull(),
    );
  }, 60_000);

  it("offers the safe retry path when the working tree has uncommitted changes", async () => {
    harness.mount();
    await waitFor(
      () => expect(screen.getByTestId("chat-input-container")).toBeTruthy(),
      { timeout: 15_000 },
    );

    const end = harness.waitForNextStreamEnd(harness.chatId);
    const { send } = await harness.typeInChat("tc=local-agent/write-index-2");
    send();
    await end;
    await waitForCleanGit(harness);

    const uncommittedPath = path.join(
      harness.appDir,
      "retry-uncommitted-change.txt",
    );
    fs.writeFileSync(uncommittedPath, "keep uncommitted work\n");

    fireEvent.click(await screen.findByRole("button", { name: /Retry/ }));
    expect(
      await screen.findByTestId("extra-commits-revert-dialog"),
    ).toBeTruthy();
    expect(screen.getByText("1 uncommitted file change")).toBeTruthy();
    expect(
      screen.getByText(
        /Please commit your changes before using Restore and retry/,
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("confirm-revert-anyway-button")).toBeNull();

    const retryEnd = harness.waitForNextStreamEnd(harness.chatId);
    fireEvent.click(screen.getByTestId("retry-from-current-code-button"));
    await retryEnd;

    expect(fs.existsSync(uncommittedPath)).toBe(true);
  }, 60_000);

  it("retries a text-only response without restoring a dirty tree", async () => {
    harness.mount();
    await waitFor(
      () => expect(screen.getByTestId("chat-input-container")).toBeTruthy(),
      { timeout: 15_000 },
    );

    const firstEnd = harness.waitForNextStreamEnd(harness.chatId);
    const { send } = await harness.typeInChat("[increment]");
    send();
    await firstEnd;
    expect(screen.getByText("counter=1")).toBeTruthy();
    const messagesBeforeRetry = await harness.db.query.messages.findMany();

    const uncommittedPath = path.join(
      harness.appDir,
      "retry-text-only-uncommitted-change.txt",
    );
    fs.writeFileSync(uncommittedPath, "preserve me\n");

    const retryEnd = harness.waitForNextStreamEnd(harness.chatId);
    fireEvent.click(await screen.findByRole("button", { name: /Retry/ }));
    expect(screen.queryByTestId("extra-commits-revert-dialog")).toBeNull();
    await retryEnd;

    expect(fs.existsSync(uncommittedPath)).toBe(true);
    await waitFor(() => expect(screen.getByText("counter=2")).toBeTruthy());
    expect(screen.queryByText("counter=1")).toBeNull();
    expect(await harness.db.query.messages.findMany()).toHaveLength(
      messagesBeforeRetry.length,
    );
  }, 60_000);
});
