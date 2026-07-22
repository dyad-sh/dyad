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

  it("retry - should work", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    // First turn: the fake server responds with counter=1.
    const { send } = await harness.typeInChat("[increment]");
    send();
    await waitFor(() => expect(screen.getByText(/counter=1/)).toBeTruthy(), {
      timeout: 20_000,
    });
    await harness.waitForStreamEnd(harness.chatId);

    // Original db assertions for the first turn.
    const firstMessages = await harness.db.query.messages.findMany();
    expect(firstMessages).toHaveLength(2);
    expect(firstMessages[0].role).toBe("user");
    expect(firstMessages[0].content).toBe("[increment]");
    expect(firstMessages[1].role).toBe("assistant");
    expect(firstMessages[1].content).toContain("counter=1");

    // Click the REAL Retry button (rendered in the footer once streaming ends).
    const retryButton = await screen.findByRole("button", { name: /Retry/ });
    // Baseline-aware gate: snapshot the current end-count BEFORE clicking retry,
    // then await a NEW chat:response:end. Plain waitForStreamEnd would resolve
    // immediately on the first turn's stale event.
    const retriedStreamEnd = harness.waitForNextStreamEnd(harness.chatId);
    fireEvent.click(retryButton);

    // The retried request replaces counter=1 with counter=2 in the DOM.
    await waitFor(
      () => {
        expect(screen.getByText(/counter=2/)).toBeTruthy();
        expect(screen.queryByText(/counter=1/)).toBeNull();
      },
      { timeout: 20_000 },
    );

    // Wait for the retry's OWN end-of-stream before asserting main-side outcomes.
    await retriedStreamEnd;

    // No error events were emitted during the flow.
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    // Still exactly one user+assistant pair — the retry replaced, not appended.
    const retriedMessages = await harness.db.query.messages.findMany();
    expect(retriedMessages).toHaveLength(2);
    expect(retriedMessages[0].role).toBe("user");
    expect(retriedMessages[0].content).toBe("[increment]");
    expect(retriedMessages[1].role).toBe("assistant");

    // The counter was incremented by the retried request.
    expect(retriedMessages[1].content).toContain("counter=2");
    expect(retriedMessages[1].content).not.toContain("counter=1");

    // The replacement rows are new db rows (old pair was deleted).
    expect(retriedMessages[0].id).not.toBe(firstMessages[0].id);
    expect(retriedMessages[1].id).not.toBe(firstMessages[1].id);
  }, 60_000);

  it("confirms before retry reverts an intermediate commit", async () => {
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

    await sendTurn("tc=write-index");
    const manualPath = path.join(harness.appDir, "retry-manual-change.txt");
    fs.writeFileSync(manualPath, "keep me\n");
    execFileSync("git", ["add", "retry-manual-change.txt"], {
      cwd: harness.appDir,
    });
    execFileSync("git", ["commit", "-m", "Manual work between AI turns"], {
      cwd: harness.appDir,
    });
    await sendTurn("tc=write-index-2");

    const messagesBefore = await harness.db.query.messages.findMany();
    const retryButton = await screen.findByRole("button", { name: /Retry/ });
    fireEvent.click(retryButton);

    expect(
      await screen.findByTestId("extra-commits-revert-dialog"),
    ).toBeTruthy();
    expect(screen.getByText("Manual work between AI turns")).toBeTruthy();
    fireEvent.click(screen.getByTestId("cancel-revert-button"));
    await waitFor(() =>
      expect(screen.queryByTestId("extra-commits-revert-dialog")).toBeNull(),
    );
    expect(fs.existsSync(manualPath)).toBe(true);
    expect(await harness.db.query.messages.findMany()).toHaveLength(
      messagesBefore.length,
    );

    const retriedStreamEnd = harness.waitForNextStreamEnd(harness.chatId);
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    fireEvent.click(await screen.findByTestId("confirm-revert-anyway-button"));
    await retriedStreamEnd;

    expect(fs.existsSync(manualPath)).toBe(false);
    await waitFor(() =>
      expect(screen.queryByTestId("extra-commits-revert-dialog")).toBeNull(),
    );
  }, 60_000);
});
