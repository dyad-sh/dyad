import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apps, chats, messages } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import { generateTestUserFixtureSource } from "@/lib/test_recorder/fixture_templates";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";

const { mockStreamText, mockGitAdd, mockGitResetFile, appRoots } = vi.hoisted(
  () => ({
    mockStreamText: vi.fn(),
    mockGitAdd: vi.fn(async () => {}),
    mockGitResetFile: vi.fn(async () => {}),
    appRoots: new Map<string, string>(),
  }),
);

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
  gitResetFile: mockGitResetFile,
}));

vi.mock("../../paths/paths", () => ({
  getDyadAppPath: (appPath: string) => appRoots.get(appPath) ?? appPath,
}));

import { registerTestAssertionHandlers } from "./test_assertion_handlers";
import { eq } from "drizzle-orm";
import {
  buildAssertionsTagContent,
  readAssertionsTagAttribute,
} from "@/lib/test_recorder/assertion_tag";
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
import {
  getRecordedTestDraft,
  resetRecordedTestDrafts,
  setRecordedTestDraft,
} from "@/ipc/services/recorded_test_drafts";
import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";

const SPEC_PATH = "e2e-tests/recorded-add-an-item.spec.ts";

const DRAFT: RecordedTestDraft = {
  version: RECORDED_TEST_DRAFT_VERSION,
  draftId: "draft-test",
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
    // Module-level, so without this each test inherits the previous one's
    // parked and already-written recordings.
    resetRecordedTestDrafts();

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
    {
      draft = DRAFT,
      proposalId = "proposal-1",
    }: { draft?: RecordedTestDraft; proposalId?: string } = {},
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
      newId: () => `${proposalId}-assertion-${nextAssertionId++}`,
    });
    harness.db
      .insert(messages)
      .values({
        chatId,
        role: "assistant",
        content:
          MESSAGE_PREFIX +
          buildAssertionsTagContent({
            proposalId,
            // The parked turn the card would resume; the tool always writes one.
            requestId: "user-input-1",
            status: "proposed",
            payload: {
              version: ASSERTION_PROPOSAL_VERSION,
              appId,
              draft,
              testTitle: draft.testName ?? "recorded test",
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

  /** Approve a card the way the renderer does: with its own stored plan. */
  function approve(appId: number, chatId: number, proposalId = "proposal-1") {
    const row = storedMessages().find((message) =>
      message.content.includes(`proposal-id="${proposalId}"`),
    )!;
    return harness.invokeHandler<{
      specPath: string;
      appliedCount: number;
      warning?: string;
    }>("tests:apply-assertions", {
      appId,
      chatId,
      proposalId,
      items: planFromMessage(row.content),
    });
  }

  // The spec file the approval writes: its name, and the sign-in fixture it
  // imports. Approving a card is the only thing that turns a recording into a
  // file, so this is where that file's shape is pinned down.
  describe("the generated spec file", () => {
    function writeFixture(source: string): string {
      const fixturePath = path.join(tmpDir, "e2e-tests/fixtures/test-user.ts");
      fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
      fs.writeFileSync(fixturePath, source, "utf-8");
      return fixturePath;
    }

    /** Approve a recording that signed in, so the fixture is written. */
    async function approveAuthenticated(): Promise<void> {
      const { appId, chatId } = seed();
      propose(appId, chatId, {
        draft: { ...DRAFT, authMode: "neon-better-auth" },
      });
      await approve(appId, chatId);
    }

    it("generates the signIn fixture for an authenticated recording", async () => {
      await approveAuthenticated();

      expect(readSpec()).toContain(
        `import { signIn } from "./fixtures/test-user";`,
      );
      expect(bodyLines()[0]).toBe(`  await signIn(page);`);
      expect(specExists("e2e-tests/fixtures/test-user.ts")).toBe(true);
    });

    // Whether a file at this path really provides `signIn` isn't decidable from
    // here, and a wrong guess blocks the user behind an error. The recording
    // becomes a test either way; a fixture that doesn't work fails when the
    // test runs, which is where it can actually be fixed.
    it.each([
      ["the user's own helper", `export async function signIn(page) {}\n`],
      ["a file that has nothing to do with us", `// mine\n`],
      [
        "our fixture with their edits in it",
        `${generateTestUserFixtureSource("supabase-password")}\n// my tweak\n`,
      ],
    ])("leaves %s at the fixture path alone", async (_label, existing) => {
      const fixturePath = writeFixture(existing);

      await approveAuthenticated();

      expect(fs.readFileSync(fixturePath, "utf-8")).toBe(existing);
      expect(specExists(SPEC_PATH)).toBe(true);
    });

    it("regenerates an untouched fixture written for the other auth backend", async () => {
      const fixturePath = writeFixture(
        generateTestUserFixtureSource("supabase-password"),
      );

      // The app moved from Supabase to Neon auth. The helper's signature is the
      // same but its body isn't, so the stale one guarantees a failing sign-in —
      // and byte equality with our own template says nobody has touched it.
      await approveAuthenticated();

      expect(fs.readFileSync(fixturePath, "utf-8")).toBe(
        generateTestUserFixtureSource("neon-better-auth"),
      );
    });

    it("suffixes rather than clobbering a spec that already exists", async () => {
      const { appId, chatId } = seed();
      // Two separate recordings whose names slugify the same.
      propose(appId, chatId, { proposalId: "proposal-1" });
      propose(appId, chatId, {
        proposalId: "proposal-2",
        draft: { ...DRAFT, draftId: "draft-second" },
      });

      const first = await approve(appId, chatId, "proposal-1");
      const second = await approve(appId, chatId, "proposal-2");

      expect(first.specPath).toBe(SPEC_PATH);
      expect(second.specPath).toBe("e2e-tests/recorded-add-an-item-2.spec.ts");
    });

    it("keeps a hostile test name inside e2e-tests/", async () => {
      const { appId, chatId } = seed();
      propose(appId, chatId, { draft: { ...DRAFT, testName: "../../evil" } });

      const result = await approve(appId, chatId);

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
      // The request is answered, so the latched card carries nothing to answer.
      // A card reloaded from here must not try to resume a dead turn.
      expect(latched).not.toContain("request-id");
      expect(latched.startsWith(MESSAGE_PREFIX)).toBe(true);
      expect(latched.endsWith(MESSAGE_SUFFIX)).toBe(true);
    });

    it("approves the named card when one message carries two", async () => {
      // The agent is free to call generate_test_assertions twice in a turn.
      // Every read and the rewrite must be scoped by proposal id, or approving
      // the second card reads — and then overwrites — the first.
      const { appId, chatId } = seed();
      propose(appId, chatId);
      const first = storedMessages()[0];
      const firstCard = first.content
        .replace(MESSAGE_PREFIX, "")
        .replace(MESSAGE_SUFFIX, "");
      const secondDraft: RecordedTestDraft = {
        ...DRAFT,
        testName: "second flow",
      };
      const secondItems = buildPlanItems({
        bodyStatements: recordedBodyStatements(secondDraft),
        stepDescriptions: [
          { index: 0, text: "Open the home page" },
          { index: 1, text: "Click the Add button" },
        ],
        assertions: [],
        newId: () => "assertion-b0",
      }).items;
      const secondCard = buildAssertionsTagContent({
        proposalId: "proposal-2",
        status: "proposed",
        payload: {
          version: ASSERTION_PROPOSAL_VERSION,
          appId,
          draft: secondDraft,
          testTitle: secondDraft.testName ?? "recorded test",
          specPath: null,
          items: secondItems,
        },
      });
      harness.db
        .update(messages)
        .set({ content: `${firstCard}\n\nand also:\n\n${secondCard}` })
        .where(eq(messages.id, first.id))
        .run();

      const result = await harness.invokeHandler<{ specPath: string }>(
        "tests:apply-assertions",
        {
          appId,
          chatId,
          proposalId: "proposal-2",
          items: secondItems,
        },
      );

      // The second card's own recording was written, not the first's.
      expect(result.specPath).toBe("e2e-tests/recorded-second-flow.spec.ts");
      expect(specExists(SPEC_PATH)).toBe(false);

      const latched = storedMessages()[0].content;
      expect(readAssertionsTagAttribute(latched, "status", "proposal-1")).toBe(
        "proposed",
      );
      expect(readAssertionsTagAttribute(latched, "status", "proposal-2")).toBe(
        "approved",
      );
      expect(latched).toContain("and also:");
    });

    it("never writes renderer-supplied assertion code", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content);
      // A compromised renderer claims the code is already good (needsCode:
      // false) while swapping in arbitrary TypeScript. Text unchanged, so
      // nothing on the wire says "re-synthesize this".
      const hostile = items.map((item) =>
        item.kind === "assertion"
          ? { ...item, code: `require("fs").rmSync("/", { recursive: true });` }
          : item,
      );

      await harness.invokeHandler("tests:apply-assertions", {
        appId,
        chatId,
        proposalId,
        items: hostile,
      });

      // The stored proposal's own validated code is what lands on disk.
      expect(bodyLines()).toEqual([
        `  await page.goto("/");`,
        `  await page.getByRole("button", { name: "Add" }).click();`,
        `  await expect(page.getByTestId("row")).toBeVisible();`,
      ]);
      expect(readSpec()).not.toContain("rmSync");
    });

    // `needsCode` is the renderer's flag, so the decision to re-synthesize has
    // to come from comparing against the stored proposal — edited text must be
    // re-synthesized either way.
    it.each([false, true])(
      "re-synthesizes edited assertion text (needsCode: %s)",
      async (needsCode) => {
        const { appId, chatId } = seed();
        const { proposalId } = propose(appId, chatId);
        const items = planFromMessage(storedMessages()[0].content);
        const edited = items.map((item) =>
          item.kind === "assertion"
            ? { ...item, text: "The heading is visible", needsCode }
            : item,
        );
        const assertion = items.find((i) => i.kind === "assertion")!;
        respondWith(
          JSON.stringify({
            assertions: [
              {
                id: assertion.kind === "assertion" ? assertion.id : "",
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

        expect(bodyLines().at(-1)).toBe(
          `  await expect(page.getByRole("heading")).toBeVisible();`,
        );
      },
    );

    it("generates one spec when the same proposal is approved twice at once", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content);

      // Two clicks in flight together. The status check and the "approved"
      // write-back have to be one critical section, or both pass and two
      // numbered specs appear.
      const [first, second] = await Promise.all([
        harness.invokeHandler<{ specPath: string; warning?: string }>(
          "tests:apply-assertions",
          { appId, chatId, proposalId, items },
        ),
        harness.invokeHandler<{ specPath: string; warning?: string }>(
          "tests:apply-assertions",
          { appId, chatId, proposalId, items },
        ),
      ]);

      expect(first.specPath).toBe(SPEC_PATH);
      expect(second.specPath).toBe(SPEC_PATH);
      expect(second.warning).toBe("This test was already generated.");
      expect(specExists("e2e-tests/recorded-add-an-item-2.spec.ts")).toBe(
        false,
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

    it("doesn't write a second spec for a recording proposed twice", async () => {
      const { appId, chatId } = seed();
      // "Ask again" in the recorder bar proposes the same parked recording
      // afresh, so two cards can describe one recording. Each generates from its
      // own copy of the draft, and nothing else connects them.
      propose(appId, chatId, { proposalId: "proposal-1" });
      propose(appId, chatId, { proposalId: "proposal-2" });

      const first = await approve(appId, chatId, "proposal-1");
      const second = await approve(appId, chatId, "proposal-2");

      expect(first.specPath).toBe(SPEC_PATH);
      expect(second.specPath).toBe(SPEC_PATH);
      expect(second.warning).toMatch(/already saved/i);
      expect(specExists("e2e-tests/recorded-add-an-item-2.spec.ts")).toBe(
        false,
      );
      // The second card settles instead of staying approvable forever.
      expect(
        readAssertionsTagAttribute(
          storedMessages()[1].content,
          "status",
          "proposal-2",
        ),
      ).toBe("approved");
    });

    it("finds the first spec by its durable draft marker after restart", async () => {
      const { appId, chatId } = seed();
      propose(appId, chatId, { proposalId: "proposal-1" });
      propose(appId, chatId, { proposalId: "proposal-2" });

      const first = await approve(appId, chatId, "proposal-1");
      // Simulate a main-process restart: the chat and generated file survive,
      // while the in-memory written-draft cache does not.
      resetRecordedTestDrafts();
      const second = await approve(appId, chatId, "proposal-2");

      expect(readSpec().split("\n", 1)[0]).toBe(
        '// dyad-recording-draft-id: "draft-test"',
      );
      expect(first.specPath).toBe(SPEC_PATH);
      expect(second.specPath).toBe(SPEC_PATH);
      expect(second.warning).toMatch(/already saved/i);
      expect(specExists("e2e-tests/recorded-add-an-item-2.spec.ts")).toBe(
        false,
      );
    });

    it("skips a concurrently removed spec while finding a durable marker", async () => {
      const { appId, chatId } = seed();
      propose(appId, chatId, { proposalId: "proposal-1" });
      propose(appId, chatId, { proposalId: "proposal-2" });
      await approve(appId, chatId, "proposal-1");
      resetRecordedTestDrafts();

      const unreadableName = "recorded-aaa-unreadable.spec.ts";
      fs.writeFileSync(
        path.join(tmpDir, "e2e-tests", unreadableName),
        "// unrelated\n",
      );
      const originalReadFile = fs.promises.readFile.bind(fs.promises);
      const readFileSpy = vi
        .spyOn(fs.promises, "readFile")
        .mockImplementation((file, options) => {
          if (String(file).endsWith(unreadableName)) {
            return Promise.reject(
              Object.assign(new Error("concurrently removed"), {
                code: "ENOENT",
              }),
            );
          }
          return originalReadFile(
            file,
            options as BufferEncoding,
          ) as ReturnType<typeof fs.promises.readFile>;
        });

      try {
        const result = await approve(appId, chatId, "proposal-2");
        expect(result.specPath).toBe(SPEC_PATH);
        expect(result.warning).toMatch(/already saved/i);
      } finally {
        readFileSpy.mockRestore();
      }
    });

    it("surfaces non-ENOENT marker read failures without writing a duplicate", async () => {
      const { appId, chatId } = seed();
      propose(appId, chatId, { proposalId: "proposal-1" });
      propose(appId, chatId, { proposalId: "proposal-2" });
      await approve(appId, chatId, "proposal-1");
      resetRecordedTestDrafts();

      const unreadableName = "recorded-aaa-unreadable.spec.ts";
      fs.writeFileSync(
        path.join(tmpDir, "e2e-tests", unreadableName),
        "// potentially the same draft\n",
      );
      const originalReadFile = fs.promises.readFile.bind(fs.promises);
      const readFileSpy = vi
        .spyOn(fs.promises, "readFile")
        .mockImplementation((file, options) => {
          if (String(file).endsWith(unreadableName)) {
            return Promise.reject(
              Object.assign(new Error("permission denied"), {
                code: "EACCES",
              }),
            );
          }
          return originalReadFile(
            file,
            options as BufferEncoding,
          ) as ReturnType<typeof fs.promises.readFile>;
        });

      try {
        await expect(approve(appId, chatId, "proposal-2")).rejects.toThrow(
          /permission denied/,
        );
        expect(specExists("e2e-tests/recorded-add-an-item-2.spec.ts")).toBe(
          false,
        );
      } finally {
        readFileSpy.mockRestore();
      }
    });

    it("does not access test files after app deletion closes admission", async () => {
      const { appId, chatId } = seed();
      propose(appId, chatId);
      const deletion = appOperationCoordinator.beginAppDeletion(appId);
      await deletion.drain();
      try {
        await expect(approve(appId, chatId)).rejects.toMatchObject({
          kind: DyadErrorKind.Precondition,
        });
      } finally {
        deletion.release();
      }

      expect(specExists()).toBe(false);
      expect(mockGitAdd).not.toHaveBeenCalled();
    });

    it("writes one spec when two cards for a recording are approved at once", async () => {
      const { appId, chatId } = seed();
      const otherChatId = Number(
        harness.db.insert(chats).values({ appId, title: "Other" }).run()
          .lastInsertRowid,
      );
      // Different chats, so the per-chat proposal lock doesn't serialize them:
      // both read "not written yet" before either writes, and without the write
      // itself being serialized each claims its own filename.
      propose(appId, chatId, { proposalId: "proposal-1" });
      propose(appId, otherChatId, { proposalId: "proposal-2" });

      const [first, second] = await Promise.all([
        approve(appId, chatId, "proposal-1"),
        approve(appId, otherChatId, "proposal-2"),
      ]);

      expect(first.specPath).toBe(SPEC_PATH);
      expect(second.specPath).toBe(SPEC_PATH);
      expect(specExists("e2e-tests/recorded-add-an-item-2.spec.ts")).toBe(
        false,
      );
    });

    it("leaves a newer recording's draft parked when an older card is approved", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content);

      // The user hid the review, recorded something else, and only then went
      // back to the old card. Clearing by appId alone would take the newer
      // recording down with it, leaving nothing able to save it.
      const newer: RecordedTestDraft = {
        ...DRAFT,
        draftId: "draft-newer",
        testName: "a newer flow",
      };
      setRecordedTestDraft(appId, newer);

      await harness.invokeHandler("tests:apply-assertions", {
        appId,
        chatId,
        proposalId,
        items,
      });

      expect(getRecordedTestDraft(appId)).toEqual(newer);
    });

    it("parks the recording again when the approval is rolled back", async () => {
      const { appId, chatId } = seed();
      propose(appId, chatId);
      setRecordedTestDraft(appId, DRAFT);
      // Latching the approval is what fails here: the spec was written, so the
      // rollback has to undo the write AND everything the write consumed.
      const updateSpy = vi
        .spyOn(harness.db, "update")
        .mockImplementationOnce(() => {
          throw new Error("couldn't latch the approval");
        });

      try {
        await expect(approve(appId, chatId)).rejects.toThrow(/couldn't latch/);
      } finally {
        updateSpy.mockRestore();
      }

      expect(specExists()).toBe(false);
      // The recording still exists and nothing was written, so the recorder
      // bar's "Generate test proposal" must still find it.
      expect(getRecordedTestDraft(appId)).toEqual(DRAFT);
    });

    it("doesn't restore a rolled-back draft over a newer recording", async () => {
      const { appId, chatId } = seed();
      propose(appId, chatId);
      setRecordedTestDraft(appId, DRAFT);
      const newer: RecordedTestDraft = { ...DRAFT, draftId: "draft-newer" };
      const updateSpy = vi
        .spyOn(harness.db, "update")
        .mockImplementationOnce(() => {
          // Recorded while the approval was in flight — the bar is offering this
          // one now, and the rollback must not displace it.
          setRecordedTestDraft(appId, newer);
          throw new Error("couldn't latch the approval");
        });

      try {
        await expect(approve(appId, chatId)).rejects.toThrow(/couldn't latch/);
      } finally {
        updateSpy.mockRestore();
      }

      expect(getRecordedTestDraft(appId)).toEqual(newer);
    });

    it("rewrites a spec deleted out from under the remembered path", async () => {
      const { appId, chatId } = seed();
      propose(appId, chatId, { proposalId: "proposal-1" });
      propose(appId, chatId, { proposalId: "proposal-2" });
      await approve(appId, chatId, "proposal-1");

      // Deleted through the Tests panel while the second card was still open.
      // The cache still names it, but "already saved" would hand that card an
      // Open button pointing at nothing.
      fs.rmSync(path.join(tmpDir, SPEC_PATH));
      const second = await approve(appId, chatId, "proposal-2");

      expect(second.specPath).toBe(SPEC_PATH);
      expect(second.warning ?? "").not.toMatch(/already saved/i);
      expect(second.appliedCount).toBeGreaterThan(0);
      expect(specExists()).toBe(true);
      expect(readSpec().split("\n", 1)[0]).toBe(
        '// dyad-recording-draft-id: "draft-test"',
      );
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

    // Either way the recording still becomes a test: losing it because one
    // assertion couldn't be written would throw away the user's whole session.
    it.each([
      [
        "the model call fails",
        /couldn't generate code/i,
        (_id: string) => {
          // Built lazily, at the moment the handler calls streamText — creating
          // the rejected promise up front would be unhandled until then.
          mockStreamText.mockImplementationOnce(() => ({
            text: Promise.reject(new Error("boom")),
          }));
        },
      ],
      [
        "the synthesized code isn't a single statement",
        /couldn't be turned into working code/i,
        (id: string) => {
          respondWith(
            JSON.stringify({
              assertions: [
                {
                  id,
                  code: `await expect(a).toBeVisible(); await expect(b).toBeVisible();`,
                },
              ],
            }),
          );
        },
      ],
      [
        "the synthesized assertion contains an executable expression",
        /couldn't be turned into working code/i,
        (id: string) => {
          respondWith(
            JSON.stringify({
              assertions: [
                {
                  id,
                  code: `await expect(process.exit()).toBeVisible();`,
                },
              ],
            }),
          );
        },
      ],
    ])(
      "skips an edited assertion when %s",
      async (_label, warning, arrange) => {
        const { appId, chatId } = seed();
        const { proposalId } = propose(appId, chatId);
        const original = planFromMessage(storedMessages()[0].content);
        const assertion = original.find((item) => item.kind === "assertion")!;
        const items = original.map((item) =>
          item.kind === "assertion"
            ? { ...item, text: "Something unrelated", needsCode: true }
            : item,
        );
        arrange(assertion.kind === "assertion" ? assertion.id : "");

        const result = await harness.invokeHandler<{
          appliedCount: number;
          warning?: string;
        }>("tests:apply-assertions", { appId, chatId, proposalId, items });

        expect(result.appliedCount).toBe(0);
        expect(result.warning).toMatch(warning);
        expect(bodyLines()).toEqual([
          `  await page.goto("/");`,
          `  await page.getByRole("button", { name: "Add" }).click();`,
        ]);
      },
    );

    // The recorded interactions must survive the round-trip exactly, or the plan
    // describes a different recording than the one about to be written.
    // Resequencing in particular used to validate, because both sides were
    // sorted while the write loop kept the submitted order.
    it.each([
      ["resequenced", (i: AssertionPlanItem[]) => [...i].reverse()],
      [
        "lost a step",
        (i: AssertionPlanItem[]) =>
          i.filter((item) => !(item.kind === "step" && item.stepIndex === 0)),
      ],
      [
        "invented a step index",
        (i: AssertionPlanItem[]) =>
          i.map((item) =>
            item.kind === "step" && item.stepIndex === 1
              ? { ...item, stepIndex: 9 }
              : item,
          ),
      ],
    ])("rejects a plan whose steps were %s", async (_label, mutate) => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = mutate(planFromMessage(storedMessages()[0].content));

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

  // Declining is as durable as approving, and for the same reason: the card is
  // not the only copy on screen. A plan closed in one window must not come back
  // approvable in another, or after a reload.
  describe("tests:discard-assertions", () => {
    function discard(appId: number, chatId: number, proposalId = "proposal-1") {
      return harness.invokeHandler<{ ok: true }>("tests:discard-assertions", {
        appId,
        chatId,
        proposalId,
      });
    }

    function status(proposalId = "proposal-1"): string | null {
      return readAssertionsTagAttribute(
        storedMessages()[0].content,
        "status",
        proposalId,
      );
    }

    it("latches the plan declined without writing anything", async () => {
      const { appId, chatId } = seed();
      propose(appId, chatId);

      await discard(appId, chatId);

      expect(status()).toBe("discarded");
      expect(specExists()).toBe(false);
      expect(mockGitAdd).not.toHaveBeenCalled();
      // Spliced in place: the agent's prose around the card survives.
      const content = storedMessages()[0].content;
      expect(content.startsWith(MESSAGE_PREFIX)).toBe(true);
      expect(content.endsWith(MESSAGE_SUFFIX)).toBe(true);
    });

    it("refuses to approve a plan that was closed", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content);

      await discard(appId, chatId);

      // A stale card left open in another window would otherwise generate the
      // very test the user closed.
      await expect(
        harness.invokeHandler("tests:apply-assertions", {
          appId,
          chatId,
          proposalId,
          items,
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
      expect(specExists()).toBe(false);
      expect(status()).toBe("discarded");
    });

    it("leaves an approved plan approved", async () => {
      const { appId, chatId } = seed();
      propose(appId, chatId);
      await approve(appId, chatId);

      // Approving already wrote a file; declining afterwards would latch a spec
      // that exists on disk as declined, and the card would stop offering to
      // open it.
      await discard(appId, chatId);

      expect(status()).toBe("approved");
      expect(specExists()).toBe(true);
    });

    it("is idempotent when the same plan is closed twice", async () => {
      const { appId, chatId } = seed();
      propose(appId, chatId);

      await expect(discard(appId, chatId)).resolves.toEqual({ ok: true });
      await expect(discard(appId, chatId)).resolves.toEqual({ ok: true });
      expect(status()).toBe("discarded");
    });

    it("rejects a chat that belongs to a different app", async () => {
      const { appId, chatId } = seed();
      propose(appId, chatId);
      const otherAppId = Number(
        harness.db.insert(apps).values({ name: "other", path: "other" }).run()
          .lastInsertRowid,
      );

      await expect(discard(otherAppId, chatId)).rejects.toMatchObject({
        kind: DyadErrorKind.Validation,
      });
      expect(status()).toBe("proposed");
    });
  });
});
