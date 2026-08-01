import { beforeEach, describe, expect, it, vi } from "vitest";

import { setRecordedTestDraft } from "@/ipc/services/recorded_test_drafts";
import {
  RECORDED_TEST_DRAFT_VERSION,
  type RecordedTestDraft,
} from "@/lib/test_recorder/draft";
import { parseAssertionsPayloadFromMessage } from "@/lib/test_recorder/assertion_tag";
import { generateTestAssertionsTool } from "./generate_test_assertions";
import type { AgentContext } from "./types";

const APP_ID = 7;

/**
 * Recorded so its statements are `goto("/")` then the click — the numbering the
 * tool validates against, and the numbering the model is given in its prompt.
 */
const DRAFT: RecordedTestDraft = {
  version: RECORDED_TEST_DRAFT_VERSION,
  testName: "add an item",
  authMode: "none",
  actions: [
    { kind: "click", locator: { kind: "role", value: "button", name: "Add" } },
  ],
};

const VALID_ARGS = {
  steps: [
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
};

function makeCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    appId: APP_ID,
    chatId: 3,
    testingEnabled: true,
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    ...overrides,
  } as unknown as AgentContext;
}

/** The single XML string the tool committed to the assistant message. */
function committedXml(ctx: AgentContext): string {
  const calls = vi.mocked(ctx.onXmlComplete).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][0];
}

describe("generate_test_assertions", () => {
  beforeEach(() => {
    setRecordedTestDraft(APP_ID, DRAFT);
  });

  it("emits a proposed card with the steps and assertions interleaved", async () => {
    const ctx = makeCtx();
    const result = await generateTestAssertionsTool.execute(VALID_ARGS, ctx);

    const xml = committedXml(ctx);
    expect(xml).toContain(`status="proposed"`);
    // No file exists yet, so the card has no path to point at.
    expect(xml).toContain(`spec-path=""`);

    const payload = parseAssertionsPayloadFromMessage(xml)!;
    expect(payload.specPath).toBeNull();
    expect(payload.testTitle).toBe("add an item");
    // The whole recording rides along, so approving never needs the registry.
    expect(payload.draft).toEqual(DRAFT);
    expect(
      payload.items.map((item) =>
        item.kind === "step" ? `step:${item.text}` : `assert:${item.text}`,
      ),
    ).toEqual([
      "step:Open the home page",
      "step:Click the Add button",
      "assert:The item list shows one row",
    ]);
    expect(
      payload.items.every(
        (item) => item.kind !== "assertion" || !item.needsCode,
      ),
    ).toBe(true);

    // The model is told the card is the end of the request.
    expect(result).toContain("1 proposed assertion(s)");
    expect(result).toContain("do NOT call run_tests");
  });

  it("rejects a plan whose indices don't match the recording, and shows the real statements", async () => {
    const ctx = makeCtx();
    const result = await generateTestAssertionsTool.execute(
      {
        ...VALID_ARGS,
        steps: [{ index: 0, text: "Open the home page" }],
        assertions: [
          {
            afterStep: 5,
            text: "Out of range",
            code: `await expect(page.getByTestId("row")).toBeVisible();`,
          },
        ],
      },
      ctx,
    );

    expect(result).toContain("no step description for statement index 1");
    expect(result).toContain("afterStep 5");
    expect(result).toContain(`1: await page.getByRole("button"`);
    // A rejected plan shows a warning, never a card.
    expect(committedXml(ctx)).toContain("dyad-output");
  });

  it("rejects assertion code that isn't a single expect statement", async () => {
    const ctx = makeCtx();
    const result = await generateTestAssertionsTool.execute(
      {
        ...VALID_ARGS,
        assertions: [
          {
            afterStep: 1,
            text: "two statements",
            code: `await expect(a).toBeVisible(); await expect(b).toBeVisible();`,
          },
        ],
      },
      ctx,
    );

    expect(result).toContain("isn't a single");
    expect(committedXml(ctx)).not.toContain("dyad-test-assertions");
  });
});
