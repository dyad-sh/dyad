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

import {
  hashSpecSource,
  registerTestAssertionHandlers,
} from "./test_assertion_handlers";
import { buildAssertionsTagContent } from "@/lib/test_recorder/assertion_tag";
import {
  ASSERTION_PROPOSAL_VERSION,
  buildPlanItems,
  type AssertionPlanItem,
} from "@/lib/test_recorder/assertion_proposal";
import { parseGeneratedSpec } from "@/lib/test_recorder/spec_edit";

const SPEC_PATH = "e2e-tests/recorded-add-item.spec.ts";

const SPEC_SOURCE = `import { test, expect } from "@playwright/test";

test("add an item", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add" }).click();
});
`;

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
    fs.mkdirSync(path.join(tmpDir, "e2e-tests"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, SPEC_PATH), SPEC_SOURCE, "utf-8");
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

  function readSpec(): string {
    return fs.readFileSync(path.join(tmpDir, SPEC_PATH), "utf-8");
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
      specSource = readSpec(),
      specPath = SPEC_PATH,
    }: { specSource?: string; specPath?: string } = {},
  ): { proposalId: string } {
    const parsed = parseGeneratedSpec(specSource)!;
    let nextAssertionId = 0;
    const { items } = buildPlanItems({
      bodyStatements: parsed.bodyStatements,
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
              specPath,
              testTitle: parsed.testTitle,
              specHash: hashSpecSource(specSource),
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

  it("writes the approved assertions and latches the message to approved", async () => {
    const { appId, chatId } = seed();
    const { proposalId } = propose(appId, chatId);
    const items = planFromMessage(storedMessages()[0].content);

    const result = await harness.invokeHandler<{
      appliedCount: number;
      warning?: string;
    }>("tests:apply-assertions", { appId, chatId, proposalId, items });

    expect(result.appliedCount).toBe(1);
    expect(result.warning).toBeUndefined();

    const written = readSpec();
    expect(written).toContain(
      `  await expect(page.getByTestId("row")).toBeVisible();`,
    );
    // The recorded interactions survive, in order, with the assertion after.
    const bodyLines = written
      .split("\n")
      .filter((line) => line.startsWith("  "));
    expect(bodyLines).toEqual([
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

    const bodyLines = readSpec()
      .split("\n")
      .filter((line) => line.startsWith("  "));
    expect(bodyLines[0]).toBe(
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

    const second = await harness.invokeHandler<{ warning?: string }>(
      "tests:apply-assertions",
      { appId, chatId, proposalId, items },
    );

    expect(second.warning).toMatch(/already applied/i);
    expect(readSpec()).toBe(afterFirst);
    expect(mockGitAdd).not.toHaveBeenCalled();
  });

  it("refuses to apply when the spec changed since the proposal", async () => {
    const { appId, chatId } = seed();
    const { proposalId } = propose(appId, chatId);
    const items = planFromMessage(storedMessages()[0].content);

    fs.writeFileSync(
      path.join(tmpDir, SPEC_PATH),
      SPEC_SOURCE.replace(`await page.goto("/");`, `await page.goto("/x");`),
      "utf-8",
    );

    await expect(
      harness.invokeHandler("tests:apply-assertions", {
        appId,
        chatId,
        proposalId,
        items,
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
  });

  it("refuses to apply into a spec that was hand-edited after the proposal", async () => {
    const { appId, chatId } = seed();
    const { proposalId } = propose(appId, chatId);
    const items = planFromMessage(storedMessages()[0].content);

    fs.writeFileSync(
      path.join(tmpDir, SPEC_PATH),
      `import { test } from "@playwright/test";

test("t", async ({ page }) => {
  // hand written
  await page.goto("/");
});
`,
      "utf-8",
    );

    await expect(
      harness.invokeHandler("tests:apply-assertions", {
        appId,
        chatId,
        proposalId,
        items,
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
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

  it("rejects a stored spec path outside the e2e-tests directory", async () => {
    const { appId, chatId } = seed();
    // A proposal whose payload points outside e2e-tests/ — the apply path
    // re-validates rather than trusting what the card sends back.
    const { proposalId } = propose(appId, chatId, {
      specPath: "src/evil.spec.ts",
    });
    const items = planFromMessage(storedMessages()[0].content);

    await expect(
      harness.invokeHandler("tests:apply-assertions", {
        appId,
        chatId,
        proposalId,
        items,
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
  });

  it("skips an edited assertion when code synthesis fails, and warns", async () => {
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
    expect(readSpec()).toBe(SPEC_SOURCE);
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
    expect(readSpec()).toBe(SPEC_SOURCE);
  });

  it("leaves the file untouched when the approved plan has no assertions", async () => {
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
    expect(result.warning).toMatch(/unchanged/i);
    expect(readSpec()).toBe(SPEC_SOURCE);
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
    expect(readSpec()).toBe(SPEC_SOURCE);
  });
});
