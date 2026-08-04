import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserInputParkValue } from "@/user_input/state";
import { setRecordedTestDraft } from "@/ipc/services/recorded_test_drafts";
import {
  RECORDED_TEST_DRAFT_VERSION,
  type RecordedTestDraft,
} from "@/lib/test_recorder/draft";
import { parseAssertionsPayloadFromMessage } from "@/lib/test_recorder/assertion_tag";
import { generateTestAssertionsTool } from "./generate_test_assertions";
import type { AgentContext } from "./types";

const APP_ID = 7;
const REQUEST_ID = "user-input-1";

/**
 * The tool blocks on the review card, so the registry is faked: `parkValue` is
 * the answer the user is standing in for, and `requests` records what the card
 * was registered as.
 */
const registry = vi.hoisted(() => ({
  requests: [] as Record<string, unknown>[],
  parkValue: null as UserInputParkValue | null,
  parked: [] as Array<{ requestId: string; signal?: AbortSignal }>,
  requestId: "user-input-1",
}));

vi.mock("@/user_input/main", () => ({
  userInputRegistry: {
    request: (descriptor: Record<string, unknown>) => {
      registry.requests.push(descriptor);
      return registry.requestId;
    },
    park: async (requestId: string, signal?: AbortSignal) => {
      registry.parked.push({ requestId, signal });
      // A park that resolves regardless of its abort signal can't tell a real
      // cancellation from a plain close, so honor the signal the way the
      // registry does: an already-aborted turn resolves to nothing.
      if (signal?.aborted) return null;
      return registry.parkValue;
    },
  },
}));

/**
 * Recorded so its statements are `goto("/")` then the click — the numbering the
 * tool validates against, and the numbering the model is given in its prompt.
 */
const DRAFT: RecordedTestDraft = {
  version: RECORDED_TEST_DRAFT_VERSION,
  draftId: "draft-test",
  testName: "add an item",
  authMode: "none",
  actions: [
    { kind: "click", locator: { kind: "role", value: "button", name: "Add" } },
  ],
};

const VALID_ARGS = {
  recordingId: DRAFT.draftId,
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
    resyncResponseFromDb: vi.fn(async () => {}),
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
    registry.requests = [];
    registry.parked = [];
    registry.parkValue = {
      kind: "test-assertions",
      specPath: "e2e-tests/recorded-add-an-item.spec.ts",
      appliedCount: 1,
    };
  });

  it("emits a proposed card with the steps and assertions interleaved", async () => {
    const ctx = makeCtx();
    const result = await generateTestAssertionsTool.execute(VALID_ARGS, ctx);

    const xml = committedXml(ctx);
    expect(xml).toContain(`status="proposed"`);
    // No file exists yet, so the card has no path to point at.
    expect(xml).toContain(`spec-path=""`);
    // The card names the request the turn is parked on, so answering it in the
    // renderer is what resumes this call.
    expect(xml).toContain(`request-id="${REQUEST_ID}"`);
    expect(registry.requests).toEqual([
      {
        kind: "test-assertions",
        chatId: 3,
        appId: APP_ID,
        proposalId: expect.any(String),
        testTitle: "add an item",
        classifier: "none",
      },
    ]);

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
    // The code, not just the sentence: this payload is what the approval
    // handler writes into the spec, so an assertion that arrives with its code
    // dropped or rewritten would generate a different test than the one the
    // model proposed and the user read.
    expect(
      payload.items.filter((item) => item.kind === "assertion"),
    ).toMatchObject([
      {
        text: "The item list shows one row",
        code: `await expect(page.getByTestId("row")).toBeVisible();`,
        origin: "model",
        needsCode: false,
      },
    ]);

    // The call only comes back once the card is answered, and the answer is
    // what the model is told about.
    expect(result).toContain("The user approved the plan");
    expect(result).toContain("e2e-tests/recorded-add-an-item.spec.ts");
    expect(result).toContain("1 assertion(s)");
    expect(result).toContain("run_tests");
    // Approving rewrote this card's tag in the message row; the turn has to
    // adopt that before it appends anything else.
    expect(ctx.resyncResponseFromDb).toHaveBeenCalledTimes(1);
  });

  it("tells the model to stop when the user closes the card", async () => {
    registry.parkValue = {
      kind: "test-assertions",
      specPath: null,
      appliedCount: 0,
    };
    const ctx = makeCtx();

    const result = await generateTestAssertionsTool.execute(VALID_ARGS, ctx);

    expect(committedXml(ctx)).toContain(`status="proposed"`);
    expect(result).toContain("closed the review card without approving");
    expect(result).toContain("do NOT call run_tests");
  });

  it("treats a swept or timed-out review as a close", async () => {
    // What `park` resolves to when the deadline fires with nobody answering.
    registry.parkValue = null;
    const ctx = makeCtx();

    const result = await generateTestAssertionsTool.execute(VALID_ARGS, ctx);

    expect(result).toContain("closed the review card without approving");
    // Parked against the card it just wrote, and handed the turn's signal —
    // without both, a stopped turn would sit on a card nothing can cancel.
    expect(registry.parked).toEqual([
      { requestId: registry.requestId, signal: ctx.abortSignal },
    ]);
  });

  it("gives up on the card when the turn is already aborted", async () => {
    // A stopped stream must not leave the tool waiting on a review the user
    // can no longer be shown.
    const ctx = makeCtx({ abortSignal: AbortSignal.abort() });

    const result = await generateTestAssertionsTool.execute(VALID_ARGS, ctx);

    expect(result).toContain("closed the review card without approving");
    expect(registry.parked[0]?.signal?.aborted).toBe(true);
  });

  it("rejects a plan for a recording that has since been replaced", async () => {
    // The call sat queued behind another turn while the user dismissed the
    // review and recorded something new. Same statement count, so the index
    // checks would wave it through and annotate the wrong flow.
    setRecordedTestDraft(APP_ID, { ...DRAFT, draftId: "draft-newer" });
    const ctx = makeCtx();

    const result = await generateTestAssertionsTool.execute(VALID_ARGS, ctx);

    expect(result).toContain("doesn't match the recording");
    expect(result).toContain("draft-newer");
    expect(committedXml(ctx)).toContain("dyad-output");
    expect(registry.requests).toEqual([]);
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
