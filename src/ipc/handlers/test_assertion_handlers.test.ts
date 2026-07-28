import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apps, chats, messages } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";

const { mockStreamText, mockGitAdd, appRoots } = vi.hoisted(() => ({
  mockStreamText: vi.fn(),
  mockGitAdd: vi.fn(async () => {}),
  appRoots: new Map<string, string>(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: mockStreamText };
});

// The harness's HandlerContext also reads writeSettings/DEFAULT_SETTINGS from
// this module, so stub the whole surface rather than just readSettings.
vi.mock("@/main/settings", () => ({
  DEFAULT_SETTINGS: {},
  readSettings: () => ({
    selectedModel: { provider: "anthropic", name: "test-model" },
  }),
  writeSettings: () => {},
}));

vi.mock("../utils/get_model_client", () => ({
  getModelClient: async () => ({
    modelClient: { model: {}, builtinProviderId: "test-provider" },
  }),
}));

vi.mock("../utils/provider_options", () => ({
  getAiHeaders: () => ({}),
  getProviderOptions: () => ({}),
}));

vi.mock("../utils/stream_text_utils", () => ({
  cancelOrphanedBaseStream: vi.fn(),
  fastTextOutput: () => undefined,
}));

vi.mock("../utils/git_utils", () => ({
  gitAdd: mockGitAdd,
}));

vi.mock("../../paths/paths", () => ({
  getDyadAppPath: (appPath: string) => appRoots.get(appPath) ?? appPath,
}));

import { registerTestAssertionHandlers } from "./test_assertion_handlers";
import { buildAssertionsTagContent } from "@/lib/test_recorder/assertion_tag";
import {
  ASSERTION_PROPOSAL_VERSION,
  buildPlanItems,
  type AssertionPlanItem,
} from "@/lib/test_recorder/assertion_proposal";
import {
  RECORDED_TEST_DRAFT_VERSION,
  type RecordedTestDraft,
} from "@/lib/test_recorder/draft";
import { recordedBodyStatements } from "@/lib/test_recorder/codegen";
import { getRecordedTestDraft } from "@/ipc/services/recorded_test_drafts";

const SPEC_PATH = "e2e-tests/recorded-add-an-item.spec.ts";

const DRAFT: RecordedTestDraft = {
  version: RECORDED_TEST_DRAFT_VERSION,
  testName: "add an item",
  authMode: "none",
  actions: [
    { kind: "click", locator: { kind: "role", value: "button", name: "Add" } },
  ],
};

/** Prose the agent wrote around the card in the same assistant message. */
const MESSAGE_PREFIX = "Here's what I'd assert:\n\n";
const MESSAGE_SUFFIX = "\n\nApprove the ones you want.";

function respondWith(text: string) {
  mockStreamText.mockReturnValueOnce({ text: Promise.resolve(text) });
}

describe("registerTestAssertionHandlers", () => {
  let harness: HandlerTestHarness;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-assertions-"));
    appRoots.set("test-app", tmpDir);

    harness = setupHandlerTestHarness();
    registerTestAssertionHandlers();
    mockStreamText.mockReset();
    mockGitAdd.mockClear();
  });

  afterEach(() => {
    harness.dispose();
    appRoots.clear();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seed(): { appId: number; chatId: number } {
    const appId = Number(
      harness.db
        .insert(apps)
        .values({ name: "test-app", path: "test-app" })
        .run().lastInsertRowid,
    );
    const chatId = Number(
      harness.db.insert(chats).values({ appId, title: "Chat" }).run()
        .lastInsertRowid,
    );
    return { appId, chatId };
  }

  function readSpec(specPath = SPEC_PATH): string {
    return fs.readFileSync(path.join(tmpDir, specPath), "utf-8");
  }

  function specExists(specPath = SPEC_PATH): boolean {
    return fs.existsSync(path.join(tmpDir, specPath));
  }

  /** The body lines of a generated spec, in order. */
  function bodyLines(specPath = SPEC_PATH): string[] {
    return readSpec(specPath)
      .split("\n")
      .filter((line) => line.startsWith("  "));
  }

  function storedMessages() {
    return harness.db.select().from(messages).all();
  }

  /**
   * Seed what the agent's `generate_test_assertions` tool leaves behind: a card
   * embedded in an assistant message that also carries the agent's own prose.
   */
  function propose(
    appId: number,
    chatId: number,
    { draft = DRAFT }: { draft?: RecordedTestDraft } = {},
  ): { proposalId: string } {
    let nextAssertionId = 0;
    const { items } = buildPlanItems({
      bodyStatements: recordedBodyStatements(draft),
      stepDescriptions: [
        { index: 0, text: "Open the home page" },
        { index: 1, text: "Click the Add button" },
      ],
      assertions: [
        {
          afterStep: 1,
          text: "The item list shows one row",
          code: `await expect(page.getByTestId("row")).toBeVisible();`,
        },
      ],
      newId: () => `assertion-${nextAssertionId++}`,
    });
    const proposalId = "proposal-1";
    harness.db
      .insert(messages)
      .values({
        chatId,
        role: "assistant",
        content:
          MESSAGE_PREFIX +
          buildAssertionsTagContent({
            proposalId,
            status: "proposed",
            payload: {
              version: ASSERTION_PROPOSAL_VERSION,
              appId,
              draft,
              testTitle: draft.testName,
              specPath: null,
              items,
            },
          }) +
          MESSAGE_SUFFIX,
        createdAt: new Date(),
      })
      .run();
    return { proposalId };
  }

  /** The plan as the card would submit it back, unmodified. */
  function planFromMessage(content: string): AssertionPlanItem[] {
    const body = /<[^>]+>([\s\S]*?)<\//.exec(content)![1];
    const json = body
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    return JSON.parse(json).items;
  }

  describe("tests:create-recorded-spec", () => {
    it("writes the recording as-is, with no assertions", async () => {
      const { appId } = seed();

      const result = await harness.invokeHandler<{ specPath: string }>(
        "tests:create-recorded-spec",
        { appId, draft: DRAFT },
      );

      expect(result.specPath).toBe(SPEC_PATH);
      expect(bodyLines()).toEqual([
        `  await page.goto("/");`,
        `  await page.getByRole("button", { name: "Add" }).click();`,
      ]);
      expect(readSpec()).not.toContain("await expect(");
      expect(mockGitAdd).toHaveBeenCalledWith({
        path: tmpDir,
        filepath: SPEC_PATH,
      });
    });

    it("generates the signIn fixture for an authenticated recording", async () => {
      const { appId } = seed();

      await harness.invokeHandler("tests:create-recorded-spec", {
        appId,
        draft: { ...DRAFT, authMode: "neon-better-auth" },
      });

      expect(readSpec()).toContain(
        `import { signIn } from "./fixtures/test-user";`,
      );
      expect(bodyLines()[0]).toBe(`  await signIn(page);`);
      expect(specExists("e2e-tests/fixtures/test-user.ts")).toBe(true);
    });

    it("never overwrites an existing fixture the user may have edited", async () => {
      const { appId } = seed();
      const fixturePath = path.join(tmpDir, "e2e-tests/fixtures/test-user.ts");
      fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
      fs.writeFileSync(fixturePath, "// mine\n", "utf-8");

      await harness.invokeHandler("tests:create-recorded-spec", {
        appId,
        draft: { ...DRAFT, authMode: "neon-better-auth" },
      });

      expect(fs.readFileSync(fixturePath, "utf-8")).toBe("// mine\n");
    });

    it("suffixes rather than clobbering a spec that already exists", async () => {
      const { appId } = seed();

      const first = await harness.invokeHandler<{ specPath: string }>(
        "tests:create-recorded-spec",
        { appId, draft: DRAFT },
      );
      const second = await harness.invokeHandler<{ specPath: string }>(
        "tests:create-recorded-spec",
        { appId, draft: DRAFT },
      );

      expect(first.specPath).toBe(SPEC_PATH);
      expect(second.specPath).toBe("e2e-tests/recorded-add-an-item-2.spec.ts");
    });

    it("keeps a hostile test name inside e2e-tests/", async () => {
      const { appId } = seed();

      const result = await harness.invokeHandler<{ specPath: string }>(
        "tests:create-recorded-spec",
        { appId, draft: { ...DRAFT, testName: "../../evil" } },
      );

      expect(result.specPath).toBe("e2e-tests/recorded-evil.spec.ts");
      expect(specExists("e2e-tests/recorded-evil.spec.ts")).toBe(true);
    });
  });

  describe("tests:apply-assertions", () => {
    it("generates the spec with the approved assertions and latches the message", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content);

      const result = await harness.invokeHandler<{
        specPath: string;
        appliedCount: number;
        warning?: string;
      }>("tests:apply-assertions", { appId, chatId, proposalId, items });

      expect(result.specPath).toBe(SPEC_PATH);
      expect(result.appliedCount).toBe(1);
      expect(result.warning).toBeUndefined();

      // The recorded interactions survive, in order, with the assertion after.
      expect(bodyLines()).toEqual([
        `  await page.goto("/");`,
        `  await page.getByRole("button", { name: "Add" }).click();`,
        `  await expect(page.getByTestId("row")).toBeVisible();`,
      ]);
      expect(mockGitAdd).toHaveBeenCalledWith({
        path: tmpDir,
        filepath: SPEC_PATH,
      });
      // The latch is spliced into the tag; the agent's own prose survives.
      const latched = storedMessages()[0].content;
      expect(latched).toContain(`status="approved"`);
      expect(latched).not.toContain(`status="proposed"`);
      expect(latched).toContain(`spec-path="${SPEC_PATH}"`);
      expect(latched.startsWith(MESSAGE_PREFIX)).toBe(true);
      expect(latched.endsWith(MESSAGE_SUFFIX)).toBe(true);
    });

    it("honors a reordered plan", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content);
      // Drag the assertion to the very top.
      const assertion = items.find((i) => i.kind === "assertion")!;
      const reordered = [assertion, ...items.filter((i) => i.kind === "step")];

      await harness.invokeHandler("tests:apply-assertions", {
        appId,
        chatId,
        proposalId,
        items: reordered,
      });

      expect(bodyLines()[0]).toBe(
        `  await expect(page.getByTestId("row")).toBeVisible();`,
      );
    });

    it("re-synthesizes code only for an edited assertion", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content);
      const edited = items.map((item) =>
        item.kind === "assertion"
          ? { ...item, text: "The page title is visible", needsCode: true }
          : item,
      );
      const assertionId = items.find((i) => i.kind === "assertion")!;
      respondWith(
        JSON.stringify({
          assertions: [
            {
              id: assertionId.kind === "assertion" ? assertionId.id : "",
              code: `await expect(page.getByRole("heading")).toBeVisible();`,
            },
          ],
        }),
      );

      await harness.invokeHandler("tests:apply-assertions", {
        appId,
        chatId,
        proposalId,
        items: edited,
      });

      expect(readSpec()).toContain(
        `  await expect(page.getByRole("heading")).toBeVisible();`,
      );
    });

    it("is an idempotent no-op when approved twice", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content);

      await harness.invokeHandler("tests:apply-assertions", {
        appId,
        chatId,
        proposalId,
        items,
      });
      const afterFirst = readSpec();
      mockGitAdd.mockClear();

      const second = await harness.invokeHandler<{
        specPath: string;
        warning?: string;
      }>("tests:apply-assertions", { appId, chatId, proposalId, items });

      expect(second.warning).toMatch(/already generated/i);
      expect(second.specPath).toBe(SPEC_PATH);
      expect(readSpec()).toBe(afterFirst);
      // Crucially, no second spec file was created alongside the first.
      expect(specExists("e2e-tests/recorded-add-an-item-2.spec.ts")).toBe(
        false,
      );
      expect(mockGitAdd).not.toHaveBeenCalled();
    });

    it("clears the pending draft so it can't be proposed against again", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content);

      await harness.invokeHandler("tests:apply-assertions", {
        appId,
        chatId,
        proposalId,
        items,
      });

      expect(getRecordedTestDraft(appId)).toBeNull();
    });

    it("rejects a chat that belongs to a different app", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content);
      const otherAppId = Number(
        harness.db.insert(apps).values({ name: "other", path: "other" }).run()
          .lastInsertRowid,
      );

      await expect(
        harness.invokeHandler("tests:apply-assertions", {
          appId: otherAppId,
          chatId,
          proposalId,
          items,
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
    });

    it("skips an edited assertion when code synthesis fails, but still generates the test", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content).map((item) =>
        item.kind === "assertion"
          ? { ...item, text: "Something unrelated", needsCode: true }
          : item,
      );
      // Build the rejected promise lazily, at the moment the handler calls
      // streamText — creating it up front would be unhandled until then.
      mockStreamText.mockImplementationOnce(() => ({
        text: Promise.reject(new Error("boom")),
      }));

      const result = await harness.invokeHandler<{
        appliedCount: number;
        warning?: string;
      }>("tests:apply-assertions", { appId, chatId, proposalId, items });

      expect(result.appliedCount).toBe(0);
      expect(result.warning).toMatch(/couldn't generate code/i);
      // The recording still becomes a test — losing it because one assertion
      // couldn't be written would throw away the user's whole session.
      expect(bodyLines()).toEqual([
        `  await page.goto("/");`,
        `  await page.getByRole("button", { name: "Add" }).click();`,
      ]);
    });

    it("skips synthesized code that isn't a single statement", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const original = planFromMessage(storedMessages()[0].content);
      const assertion = original.find((item) => item.kind === "assertion")!;
      const items = original.map((item) =>
        item.kind === "assertion"
          ? { ...item, text: "Something unrelated", needsCode: true }
          : item,
      );
      respondWith(
        JSON.stringify({
          assertions: [
            {
              id: assertion.kind === "assertion" ? assertion.id : "",
              code: `await expect(a).toBeVisible(); await expect(b).toBeVisible();`,
            },
          ],
        }),
      );

      const result = await harness.invokeHandler<{
        appliedCount: number;
        warning?: string;
      }>("tests:apply-assertions", { appId, chatId, proposalId, items });

      expect(result.appliedCount).toBe(0);
      expect(result.warning).toMatch(/couldn't be turned into working code/i);
      expect(readSpec()).not.toContain("await expect(");
    });

    it("generates the recorded steps when the user removed every assertion", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content).filter(
        (item) => item.kind === "step",
      );

      const result = await harness.invokeHandler<{
        appliedCount: number;
        warning?: string;
      }>("tests:apply-assertions", { appId, chatId, proposalId, items });

      expect(result.appliedCount).toBe(0);
      expect(result.warning).toBeUndefined();
      expect(bodyLines()).toEqual([
        `  await page.goto("/");`,
        `  await page.getByRole("button", { name: "Add" }).click();`,
      ]);
      expect(storedMessages()[0].content).toContain(`status="approved"`);
    });

    it("rejects a plan that lost a recorded step", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content).filter(
        (item) => !(item.kind === "step" && item.stepIndex === 0),
      );

      await expect(
        harness.invokeHandler("tests:apply-assertions", {
          appId,
          chatId,
          proposalId,
          items,
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
      expect(specExists()).toBe(false);
    });

    it("rejects a plan that invented a step index", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content).map((item) =>
        item.kind === "step" && item.stepIndex === 1
          ? { ...item, stepIndex: 9 }
          : item,
      );

      await expect(
        harness.invokeHandler("tests:apply-assertions", {
          appId,
          chatId,
          proposalId,
          items,
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
      expect(specExists()).toBe(false);
    });
  });
});
