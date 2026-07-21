// Migrated from e2e-tests/security_review.spec.ts, then converted from the
// node chat-flow harness to the HYBRID harness (real <ChatPanel> over the real
// IPC stack). The describe/it names are kept identical to the node version on
// purpose: the existing "security-review-dump" snapshot then acts as a
// cross-harness equivalence oracle — proving the UI-driven review turn sends
// byte-for-byte the same LLM payload the node harness did.
//
// Covers the security-review flow:
//  - a "/security-review" prompt (typed + sent through the real UI) swaps in
//    the security-review system prompt and yields an assistant message full of
//    <dyad-security-finding> tags, which render in the messages list (the
//    same DOM surface the e2e asserted) and are parsed by the real
//    get-latest-security-review handler;
//  - the LLM request payload for the review turn (masked server dump);
//  - project SECURITY_RULES.md is picked up both into the codebase context and
//    appended to the (unmasked) system prompt;
//  - the "Fix Issue" / "Fix N Issues" prompts (built the same way
//    SecurityPanel.tsx builds them) run in their own new chats and produce an
//    approved, committed change ("Version 2" in the e2e UI == a new commit).
//
// UI-only assertions from the e2e spec that live outside the chat panel
// (findings-table aria snapshot, chat tab counts, checkbox multi-select
// interactions in SecurityPanel) are intentionally dropped.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { messages as messagesTable, security_fix_chats } from "@/db/schema";
import type { SecurityFinding } from "@/ipc/types/security";
import { and, asc, desc, eq } from "drizzle-orm";

const LARGE_REVIEW_STREAM_TIMEOUT_MS = 90_000;

describe("security review (integration)", () => {
  let harness: HybridChatHarness;
  let findings: SecurityFinding[] = [];

  // For review/fix chats created here we read the right chat's rows directly.
  const loadChatMessages = (chatId: number) =>
    harness.db.query.messages.findMany({
      where: eq(messagesTable.chatId, chatId),
      orderBy: [asc(messagesTable.id)],
    });

  const getLatestSecurityReview = async () => {
    const handler = h.ipcHandlers.get("get-latest-security-review")!;
    const frame = { url: "http://localhost:5173/" };
    const envelope = (await handler(
      {
        sender: { mainFrame: frame, isDestroyed: () => false, send: () => {} },
        senderFrame: frame,
      },
      harness.appId,
    )) as {
      ok: boolean;
      value?: { findings: SecurityFinding[]; chatId: number };
      error?: unknown;
    };
    expect(envelope.ok).toBe(true);
    return envelope.value!;
  };

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
    // Baseline turn, mirroring the e2e's `sendPrompt("tc=1")`.
    await harness.streamChat("tc=1");
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("runs a security review and parses findings", async () => {
    const reviewChatId = await harness.createChat();
    harness.mount({ chatId: reviewChatId });
    await waitFor(
      () => expect(screen.getByTestId("chat-input-container")).toBeTruthy(),
      { timeout: 15_000 },
    );

    // Type + send "/security-review" through the real UI. Baseline-aware wait:
    // the beforeAll turn already emitted a chat:response:end.
    // The 6 KB findings response streams through the full renderer/IPC stack.
    // Loaded Windows runners can exceed the harness's 20-second default while
    // still making steady chunk progress, so give this large turn headroom.
    const reviewEnd = harness.waitForNextStreamEnd(
      reviewChatId,
      LARGE_REVIEW_STREAM_TIMEOUT_MS,
    );
    const { send } = await harness.typeInChat("/security-review", {
      chatId: reviewChatId,
    });
    send();

    // The streamed review renders in the messages list: the intro text and the
    // <dyad-security-finding> cards' content (the same DOM surface the e2e
    // asserted on).
    await waitFor(
      () =>
        expect(
          screen.getByText(/OK, let's review the security\./),
        ).toBeTruthy(),
      { timeout: 20_000 },
    );
    await waitFor(
      () => {
        expect(
          screen.getAllByText(/Unvalidated File Upload Extensions/).length,
        ).toBeGreaterThan(0);
        expect(
          screen.getAllByText(/SQL Injection in User Lookup/).length,
        ).toBeGreaterThan(0);
      },
      { timeout: 20_000 },
    );
    await reviewEnd;
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    const messages = await loadChatMessages(reviewChatId);
    const assistant = messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toContain("<dyad-security-finding");

    // The request payload for the review turn: security system prompt (masked),
    // fresh codebase context, and the raw "/security-review" prompt.
    const dump = harness.getServerDump({ type: "all-messages" });
    expect(dump.text).toContain("message: [[SYSTEM_MESSAGE]]");
    expect(dump.text).toContain("This is my codebase.");
    expect(dump.text.trimEnd()).toMatch(
      /role: user\nmessage: \/security-review$/,
    );
    expect(dump.text).toMatchSnapshot("security-review-dump");

    // The unmasked system prompt actually sent is the security review prompt.
    const raw = JSON.parse(fs.readFileSync(dump.dumpPath, "utf-8"));
    const systemMessage = raw.body.messages.find(
      (m: { role: string }) => m.role === "system",
    );
    expect(systemMessage.content).toContain("Security expert");

    // The real get-latest-security-review handler parses the findings.
    const review = await getLatestSecurityReview();
    expect(review.chatId).toBe(reviewChatId);
    expect(review.findings.length).toBeGreaterThanOrEqual(4);
    for (const finding of review.findings) {
      expect(finding.title).toBeTruthy();
      expect(["critical", "high", "medium", "low"]).toContain(finding.level);
      expect(finding.description).toBeTruthy();
    }
    findings = review.findings;
  }, 120_000);

  it("fix issue: streams the fix prompt in a new chat and commits the change", async () => {
    expect(findings.length).toBeGreaterThan(0);
    const finding = findings[0];

    // Prompt built exactly like SecurityPanel.handleFixIssue.
    const prompt = `Please fix the following security issue in a simple and effective way:

**${finding.title}** (${finding.level} severity)

${finding.description}`;

    const commitsBefore = harness.gitLog().length;
    const fixChatId = await harness.createChat();
    harness.mount({ chatId: fixChatId });
    await waitFor(
      () => expect(screen.getByTestId("chat-input-container")).toBeTruthy(),
      { timeout: 15_000 },
    );

    const fixEnd = harness.waitForNextStreamEnd(fixChatId);
    const { send } = await harness.typeInChat(prompt, { chatId: fixChatId });
    send();

    // The fix prompt renders as the user message, and the canned response's
    // trailing "EOM" text renders once the assistant turn streams in.
    await waitFor(
      () =>
        expect(
          screen.getByText(/Please fix the following security issue/),
        ).toBeTruthy(),
      { timeout: 15_000 },
    );
    await waitFor(() => expect(screen.getByText(/EOM/)).toBeTruthy(), {
      timeout: 20_000,
    });
    await fixEnd;

    const messages = await loadChatMessages(fixChatId);
    const user = messages.find((m) => m.role === "user")!;
    expect(user.content).toMatch(/^Please fix the following security issue/);
    expect(user.content).toContain(finding.title);

    // The canned response writes file1.txt; auto-approve commits it — the
    // "Version 2:" marker asserted in the e2e messages list.
    const assistant = messages.find((m) => m.role === "assistant")!;
    expect(assistant.approvalState).toBe("approved");
    expect(assistant.commitHash).toBeTruthy();
    expect(harness.appFileExists("file1.txt")).toBe(true);
    expect(harness.gitLog().length).toBeGreaterThan(commitsBefore);
    await harness.bridge.settleInFlight();
  }, 60_000);

  it("fixes all issues, shows the bulk fix, and re-runs it in the same chat", async () => {
    expect(findings.length).toBeGreaterThanOrEqual(2);

    // The previous test committed the canned file1.txt write. Perturb and
    // commit it so this UI-driven bulk fix produces another real change.
    await harness.bridge.settleInFlight();
    fs.writeFileSync(path.join(harness.appDir, "file1.txt"), "perturbed\n");
    execFileSync("git", ["add", "-A"], { cwd: harness.appDir });
    execFileSync(
      "git",
      [
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Test User",
        "commit",
        "-m",
        "perturb file1.txt",
      ],
      { cwd: harness.appDir },
    );

    cleanup();
    harness.mount({ withSecurityPanel: true });
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "Fix all issues" }),
        ).toBeTruthy(),
      { timeout: 15_000 },
    );

    fireEvent.click(screen.getByRole("button", { name: "Fix all issues" }));

    let bulkFixChatId: number | undefined;
    await waitFor(async () => {
      const [bulkFix] = await harness.db
        .select()
        .from(security_fix_chats)
        .where(
          and(
            eq(security_fix_chats.appId, harness.appId),
            eq(
              security_fix_chats.reviewChatId,
              (await getLatestSecurityReview()).chatId,
            ),
          ),
        )
        .orderBy(desc(security_fix_chats.id))
        .limit(1);
      expect(bulkFix).toBeTruthy();
      bulkFixChatId = bulkFix.fixChatId;
    });
    expect(bulkFixChatId).toBeDefined();
    await harness.waitForStreamEnd(bulkFixChatId);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Show fix for all issues" }),
      ).toBeTruthy();
      expect(
        screen
          .getByRole("button", { name: "Run review" })
          .getAttribute("data-variant"),
      ).toBe("primary");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Show fix for all issues" }),
    );
    await waitFor(() => {
      expect(harness.currentLocation().search.id).toBe(bulkFixChatId);
    });

    // Make the canned rerun write produce a fresh commit too.
    await harness.bridge.settleInFlight();
    fs.writeFileSync(
      path.join(harness.appDir, "file1.txt"),
      "perturbed again\n",
    );
    execFileSync("git", ["add", "-A"], { cwd: harness.appDir });
    execFileSync(
      "git",
      [
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Test User",
        "commit",
        "-m",
        "perturb file1.txt again",
      ],
      { cwd: harness.appDir },
    );

    const rerunEnd = harness.waitForNextStreamEnd(bulkFixChatId);
    const moreActions = screen.getByRole("button", {
      name: "More fix actions for all issues",
    });
    await harness.openPopover(moreActions);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Re-run fix" }),
    );
    await rerunEnd;

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Show fix for all issues" }),
      ).toBeTruthy(),
    );
    const bulkMessages = await loadChatMessages(bulkFixChatId!);
    const bulkPrompts = bulkMessages.filter(
      (message) => message.role === "user",
    );
    expect(bulkPrompts).toHaveLength(2);
    for (const prompt of bulkPrompts) {
      expect(prompt.content).toContain(
        `Please fix the following ${findings.length} security issues`,
      );
    }

    const matchingFixChats = await harness.db
      .select()
      .from(security_fix_chats)
      .where(eq(security_fix_chats.fixChatId, bulkFixChatId!));
    expect(matchingFixChats).toHaveLength(1);
  }, 60_000);

  it("edit and use knowledge: SECURITY_RULES.md is added to the review context", async () => {
    // The e2e edits the rules via the dialog; the saved file lands in the app
    // dir. Write it directly and run another review.
    fs.writeFileSync(
      path.join(harness.appDir, "SECURITY_RULES.md"),
      "testing\nrules123",
    );

    const reviewChatId = await harness.createChat();
    harness.mount({ chatId: reviewChatId });
    await waitFor(
      () => expect(screen.getByTestId("chat-input-container")).toBeTruthy(),
      { timeout: 15_000 },
    );

    const reviewEnd = harness.waitForNextStreamEnd(
      reviewChatId,
      LARGE_REVIEW_STREAM_TIMEOUT_MS,
    );
    const { send } = await harness.typeInChat("/security-review", {
      chatId: reviewChatId,
    });
    send();

    // The review response (with its security-finding cards) renders again.
    await waitFor(
      () =>
        expect(
          screen.getByText(/OK, let's review the security\./),
        ).toBeTruthy(),
      { timeout: 20_000 },
    );
    await reviewEnd;

    const dump = harness.getServerDump({ type: "all-messages" });
    // The rules file shows up in the codebase context...
    expect(dump.text).toContain('<dyad-file path="SECURITY_RULES.md">');
    expect(dump.text).toContain("rules123");

    // ...and is appended to the (unmasked) security system prompt.
    const raw = JSON.parse(fs.readFileSync(dump.dumpPath, "utf-8"));
    const systemMessage = raw.body.messages.find(
      (m: { role: string }) => m.role === "system",
    );
    expect(systemMessage.content).toContain(
      "# Project-specific security rules:",
    );
    expect(systemMessage.content).toContain("rules123");
  }, 120_000);
});
