import { beforeEach, describe, expect, it, vi } from "vitest";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  hashSpecSource,
  loadSpecForAssertions,
} from "@/ipc/handlers/test_assertion_handlers";
import { parseGeneratedSpec } from "@/lib/test_recorder/spec_edit";
import { parseAssertionsPayloadFromMessage } from "@/lib/test_recorder/assertion_tag";
import { generateTestAssertionsTool } from "./generate_test_assertions";
import type { AgentContext } from "./types";

vi.mock("@/ipc/handlers/test_assertion_handlers", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/ipc/handlers/test_assertion_handlers")
    >();
  return { ...actual, loadSpecForAssertions: vi.fn() };
});

const SPEC_PATH = "e2e-tests/recorded-add-item.spec.ts";

const SPEC_SOURCE = `import { test } from "@playwright/test";

test("add an item", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add" }).click();
});
`;

const VALID_ARGS = {
  specPath: SPEC_PATH,
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
    appId: 7,
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
    vi.mocked(loadSpecForAssertions).mockReset();
    vi.mocked(loadSpecForAssertions).mockResolvedValue({
      appPath: "/apps/test-app",
      source: SPEC_SOURCE,
      parsed: parseGeneratedSpec(SPEC_SOURCE)!,
    });
  });

  it("is gated on the app's testing opt-in and excluded from read-only modes", () => {
    expect(
      generateTestAssertionsTool.isEnabled!(
        makeCtx({ testingEnabled: false } as Partial<AgentContext>),
      ),
    ).toBe(false);
    expect(generateTestAssertionsTool.isEnabled!(makeCtx())).toBe(true);
    expect(generateTestAssertionsTool.modifiesState).toBe(true);
  });

  it("emits a proposed card with the steps and assertions interleaved", async () => {
    const ctx = makeCtx();
    const result = await generateTestAssertionsTool.execute(VALID_ARGS, ctx);

    const xml = committedXml(ctx);
    expect(xml).toContain(`status="proposed"`);
    expect(xml).toContain(`spec-path="${SPEC_PATH}"`);

    const payload = parseAssertionsPayloadFromMessage(xml)!;
    expect(payload.specPath).toBe(SPEC_PATH);
    expect(payload.testTitle).toBe("add an item");
    // Pinned to the source we read, so a later edit invalidates the proposal.
    expect(payload.specHash).toBe(hashSpecSource(SPEC_SOURCE));
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
    expect(result).toContain("Do NOT edit");
  });

  it("rejects a plan whose indices don't match the spec, and shows the real statements", async () => {
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

  it("reports a hand-edited spec back to the model instead of throwing", async () => {
    vi.mocked(loadSpecForAssertions).mockRejectedValue(
      new DyadError("hand-edited", DyadErrorKind.Precondition),
    );
    const ctx = makeCtx();

    const result = await generateTestAssertionsTool.execute(VALID_ARGS, ctx);

    expect(result).toContain("hand-edited");
    expect(result).toContain("search_replace");
    expect(committedXml(ctx)).toContain("dyad-output");
  });

  it("accepts an empty assertion list", async () => {
    const ctx = makeCtx();
    const result = await generateTestAssertionsTool.execute(
      { ...VALID_ARGS, assertions: [] },
      ctx,
    );

    const payload = parseAssertionsPayloadFromMessage(committedXml(ctx))!;
    expect(payload.items).toHaveLength(2);
    expect(result).toContain("0 proposed assertion(s)");
  });
});
