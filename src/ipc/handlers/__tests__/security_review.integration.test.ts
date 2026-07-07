// @vitest-environment happy-dom
// @vitest-environment-options {"happyDOM": {"settings": {"fetch": {"disableSameOriginPolicy": true}}}}
//
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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "en", changeLanguage: async () => {} },
  }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// The review markdown contains code spans, which render through
// CodeHighlight -> useTheme. The harness mounts <ChatPanel> without the app's
// ThemeProvider (renderer.tsx provides it in production), so supply a minimal
// theme context here.
vi.mock("@/contexts/ThemeContext", () => ({
  ThemeProvider: ({ children }: { children?: unknown }) => children ?? null,
  useTheme: () => ({ theme: "light", isDarkMode: false, setTheme: () => {} }),
}));

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { messages as messagesTable } from "@/db/schema";
import type { SecurityFinding } from "@/ipc/types/security";
import { asc, eq } from "drizzle-orm";

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
    const envelope = (await handler(
      { sender: { isDestroyed: () => false, send: () => {} } },
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
    const reviewEnd = harness.waitForNextStreamEnd(reviewChatId);
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
  }, 60_000);

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
  }, 60_000);

  it("multi-select fix: streams a combined 2-issue prompt in a new chat", async () => {
    expect(findings.length).toBeGreaterThanOrEqual(2);
    const findingsToFix = findings.slice(0, 2);

    // The previous test already committed the canned file1.txt write; perturb
    // and commit it so this turn's identical canned write is a real change
    // again (each e2e test ran against a fresh app).
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

    // Prompt built exactly like SecurityPanel.handleFixSelected.
    const issuesList = findingsToFix
      .map(
        (finding, index) =>
          `${index + 1}. **${finding.title}** (${finding.level} severity)\n${finding.description}`,
      )
      .join("\n\n");
    const prompt = `Please fix the following ${findingsToFix.length} security issue${findingsToFix.length !== 1 ? "s" : ""} in a simple and effective way:

${issuesList}`;

    const fixChatId = await harness.createChat();
    harness.mount({ chatId: fixChatId });
    await waitFor(
      () => expect(screen.getByTestId("chat-input-container")).toBeTruthy(),
      { timeout: 15_000 },
    );

    const fixEnd = harness.waitForNextStreamEnd(fixChatId);
    const { send } = await harness.typeInChat(prompt, { chatId: fixChatId });
    send();

    await waitFor(
      () =>
        expect(
          screen.getByText(/Please fix the following 2 security issues/),
        ).toBeTruthy(),
      { timeout: 15_000 },
    );
    await waitFor(() => expect(screen.getByText(/EOM/)).toBeTruthy(), {
      timeout: 20_000,
    });
    await fixEnd;

    const messages = await loadChatMessages(fixChatId);
    const user = messages.find((m) => m.role === "user")!;
    expect(user.content).toMatch(/^Please fix the following 2 security issues/);
    expect(user.content).toContain(findingsToFix[0].title);
    expect(user.content).toContain(findingsToFix[1].title);

    const assistant = messages.find((m) => m.role === "assistant")!;
    expect(assistant.approvalState).toBe("approved");
    expect(assistant.commitHash).toBeTruthy();
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

    const reviewEnd = harness.waitForNextStreamEnd(reviewChatId);
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
  }, 60_000);
});
