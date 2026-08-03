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
            // The parked turn the card would resume; the tool always writes one.
            requestId: "user-input-1",
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
    /**
     * Save a recording the way the recorder bar does: the draft is parked in the
     * main process when recording stops, and its presence is what says this
     * recording hasn't been written yet.
     */
    function createSpec(appId: number, draft: RecordedTestDraft = DRAFT) {
      setRecordedTestDraft(appId, draft);
      return harness.invokeHandler<{ specPath: string }>(
        "tests:create-recorded-spec",
        { appId, draft },
      );
    }

    it("writes the recording as-is, with no assertions", async () => {
      const { appId } = seed();

      const result = await createSpec(appId);

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

      await createSpec(appId, { ...DRAFT, authMode: "neon-better-auth" });

      expect(readSpec()).toContain(
        `import { signIn } from "./fixtures/test-user";`,
      );
      expect(bodyLines()[0]).toBe(`  await signIn(page);`);
      expect(specExists("e2e-tests/fixtures/test-user.ts")).toBe(true);
    });

    function writeFixture(source: string): string {
      const fixturePath = path.join(tmpDir, "e2e-tests/fixtures/test-user.ts");
      fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
      fs.writeFileSync(fixturePath, source, "utf-8");
      return fixturePath;
    }

    it("reuses the user's own signIn helper without touching it", async () => {
      const { appId } = seed();
      const mine = `export async function signIn(page) {\n  // mine\n}\n`;
      const fixturePath = writeFixture(mine);

      await createSpec(appId, { ...DRAFT, authMode: "neon-better-auth" });

      expect(fs.readFileSync(fixturePath, "utf-8")).toBe(mine);
    });

    it("refuses when the fixture path is taken by a file with no signIn", async () => {
      const { appId } = seed();
      // The generated spec imports `signIn` from here, so silently reusing this
      // would report success and leave the user with a spec that can't compile.
      const fixturePath = writeFixture("// mine\n");

      await expect(
        createSpec(appId, { ...DRAFT, authMode: "neon-better-auth" }),
      ).rejects.toThrow(/doesn't export a `signIn` helper/);
      expect(fs.readFileSync(fixturePath, "utf-8")).toBe("// mine\n");
      expect(specExists(SPEC_PATH)).toBe(false);
    });

    it("regenerates a fixture that was generated for the other auth backend", async () => {
      const { appId } = seed();
      const fixturePath = writeFixture(
        generateTestUserFixtureSource("supabase-password"),
      );

      // The app moved from Supabase to Neon auth. The helper's signature is the
      // same but its body isn't, so the stale one guarantees a failing sign-in.
      await createSpec(appId, { ...DRAFT, authMode: "neon-better-auth" });

      expect(fs.readFileSync(fixturePath, "utf-8")).toBe(
        generateTestUserFixtureSource("neon-better-auth"),
      );
    });

    it("refuses to discard edits made to a fixture for the other backend", async () => {
      const { appId } = seed();
      const edited = `${generateTestUserFixtureSource("supabase-password")}\n// my tweak\n`;
      const fixturePath = writeFixture(edited);

      await expect(
        createSpec(appId, { ...DRAFT, authMode: "neon-better-auth" }),
      ).rejects.toThrow(/has been edited/);
      expect(fs.readFileSync(fixturePath, "utf-8")).toBe(edited);
    });

    it("suffixes rather than clobbering a spec that already exists", async () => {
      const { appId } = seed();

      // Two separate recordings whose names slugify the same.
      const first = await createSpec(appId);
      const second = await createSpec(appId);

      expect(first.specPath).toBe(SPEC_PATH);
      expect(second.specPath).toBe("e2e-tests/recorded-add-an-item-2.spec.ts");
    });

    it("refuses a recording that has already been written", async () => {
      const { appId } = seed();
      await createSpec(appId);

      // The bar can still be on screen after the assertions card generated the
      // spec (or after a double click). Writing again would leave the user with
      // two copies of the same recording under different names.
      await expect(
        harness.invokeHandler("tests:create-recorded-spec", {
          appId,
          draft: DRAFT,
        }),
      ).rejects.toThrow(/already been saved/);
      expect(specExists("e2e-tests/recorded-add-an-item-2.spec.ts")).toBe(
        false,
      );
    });

    it("writes one spec when two saves race", async () => {
      const { appId } = seed();
      setRecordedTestDraft(appId, DRAFT);

      // Both read the parked draft before either clears it. Without the write
      // being serialized, each claims its own filename.
      const [first, second] = await Promise.allSettled([
        harness.invokeHandler<{ specPath: string }>(
          "tests:create-recorded-spec",
          { appId, draft: DRAFT },
        ),
        harness.invokeHandler<{ specPath: string }>(
          "tests:create-recorded-spec",
          { appId, draft: DRAFT },
        ),
      ]);

      const written = [first, second].filter((r) => r.status === "fulfilled");
      expect(written).toHaveLength(1);
      expect(specExists(SPEC_PATH)).toBe(true);
      expect(specExists("e2e-tests/recorded-add-an-item-2.spec.ts")).toBe(
        false,
      );
    });

    it("keeps a hostile test name inside e2e-tests/", async () => {
      const { appId } = seed();

      const result = await createSpec(appId, {
        ...DRAFT,
        testName: "../../evil",
      });

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
          testTitle: secondDraft.testName,
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

    it("doesn't write a second spec for a recording the bar already saved", async () => {
      const { appId, chatId } = seed();
      const { proposalId } = propose(appId, chatId);
      const items = planFromMessage(storedMessages()[0].content);

      // The bar keeps offering "Save without assertions" while the card is on
      // screen. It writes from the parked draft; this path writes from the
      // card's own copy, so nothing else connects the two.
      setRecordedTestDraft(appId, DRAFT);
      await harness.invokeHandler("tests:create-recorded-spec", {
        appId,
        draft: DRAFT,
      });

      const approved = await harness.invokeHandler<{
        specPath: string;
        warning?: string;
      }>("tests:apply-assertions", { appId, chatId, proposalId, items });

      expect(approved.specPath).toBe(SPEC_PATH);
      expect(approved.warning).toMatch(/already saved/i);
      expect(specExists("e2e-tests/recorded-add-an-item-2.spec.ts")).toBe(
        false,
      );
      // The card settles instead of staying approvable forever.
      expect(storedMessages()[0].content).toContain('status="approved"');
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
});
