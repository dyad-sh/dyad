import { describe, expect, it } from "vitest";

import { parseFullMessage } from "../streamingMessageParser";
import {
  ASSERTIONS_TAG,
  buildAssertionsTagContent,
  messageHasAssertionsProposal,
  parseAssertionsPayload,
  parseAssertionsPayloadFromMessage,
  readAssertionsTagAttribute,
  replaceAssertionsTagInMessage,
} from "./assertion_tag";
import {
  ASSERTION_PROPOSAL_VERSION,
  type AssertionProposalPayload,
} from "./assertion_proposal";
import { RECORDED_TEST_DRAFT_VERSION } from "./draft";

// Deliberately hostile text: XML-significant characters plus a literal closing
// tag, which is exactly what would break the card if escaping regressed.
const PAYLOAD: AssertionProposalPayload = {
  version: ASSERTION_PROPOSAL_VERSION,
  appId: 3,
  draft: {
    version: RECORDED_TEST_DRAFT_VERSION,
    draftId: "draft-test",
    testName: "add <an> item",
    authMode: "none",
    actions: [
      {
        kind: "click",
        locator: { kind: "role", value: "button", name: "Add" },
      },
    ],
  },
  specPath: "e2e-tests/recorded-add & edit.spec.ts",
  testTitle: "add <an> item",
  items: [
    { kind: "step", stepIndex: 0, text: "Open /" },
    {
      kind: "assertion",
      id: "a1",
      text: `The count is > 1 && < 5, not </${ASSERTIONS_TAG}>`,
      code: `await expect(page.getByText("a & b")).toBeVisible();`,
      needsCode: false,
      origin: "model",
    },
  ],
};

describe("assertion tag round-trip", () => {
  const content = buildAssertionsTagContent({
    proposalId: "prop-1",
    status: "proposed",
    payload: PAYLOAD,
  });

  it("survives the streaming parser the chat card reads it through", () => {
    const { blocks } = parseFullMessage(content);
    const block = blocks.find(
      (b) => b.kind === "custom-tag" && b.tag === ASSERTIONS_TAG,
    );
    expect(block).toBeDefined();
    if (block?.kind !== "custom-tag") throw new Error("expected a custom tag");

    expect(block.attributes["proposal-id"]).toBe("prop-1");
    expect(block.attributes.status).toBe("proposed");
    expect(block.attributes["spec-path"]).toBe(PAYLOAD.specPath);
    expect(parseAssertionsPayload(block.content)).toEqual(PAYLOAD);
  });
});

describe("replaceAssertionsTagInMessage", () => {
  const proposed = buildAssertionsTagContent({
    proposalId: "prop-1",
    status: "proposed",
    payload: PAYLOAD,
  });
  const approved = buildAssertionsTagContent({
    proposalId: "prop-1",
    status: "approved",
    payload: PAYLOAD,
  });

  it("swaps only the tag, keeping the agent's message around it", () => {
    // The tool emits the card mid-message, so approving must not disturb the
    // agent's prose or a sibling tool card.
    const message = `Here's my plan.\n\n${proposed}\n\n<dyad-status title="Ran tests">ok</dyad-status>\n\nApprove when ready.`;

    const next = replaceAssertionsTagInMessage(message, approved)!;

    expect(next).toBe(
      `Here's my plan.\n\n${approved}\n\n<dyad-status title="Ran tests">ok</dyad-status>\n\nApprove when ready.`,
    );
    expect(readAssertionsTagAttribute(next, "status")).toBe("approved");
    expect(parseAssertionsPayloadFromMessage(next)).toEqual(PAYLOAD);
  });

  it("inserts a payload containing `$&` verbatim", () => {
    // `String.replace` would expand `$&` in a string replacement.
    const dollarPayload: AssertionProposalPayload = {
      ...PAYLOAD,
      items: [{ kind: "step", stepIndex: 0, text: "Type $& into the field" }],
    };
    const next = replaceAssertionsTagInMessage(
      `prose ${proposed}`,
      buildAssertionsTagContent({
        proposalId: "prop-1",
        status: "approved",
        payload: dollarPayload,
      }),
    )!;

    expect(parseAssertionsPayloadFromMessage(next)).toEqual(dollarPayload);
  });

  it("reads and rewrites the card named by proposal id, not the first one", () => {
    // One assistant message can carry two cards — the agent is free to call the
    // tool twice in a turn. Approving the second must not read, or overwrite,
    // the first.
    const second = buildAssertionsTagContent({
      proposalId: "prop-2",
      status: "proposed",
      payload: { ...PAYLOAD, testTitle: "second flow" },
    });
    const message = `First:\n\n${proposed}\n\nSecond:\n\n${second}`;

    expect(readAssertionsTagAttribute(message, "proposal-id", "prop-2")).toBe(
      "prop-2",
    );
    expect(
      parseAssertionsPayloadFromMessage(message, "prop-2")?.testTitle,
    ).toBe("second flow");
    expect(messageHasAssertionsProposal(message, "prop-2")).toBe(true);
    expect(messageHasAssertionsProposal(message, "prop-3")).toBe(false);

    const approvedSecond = buildAssertionsTagContent({
      proposalId: "prop-2",
      status: "approved",
      payload: { ...PAYLOAD, testTitle: "second flow" },
    });
    const next = replaceAssertionsTagInMessage(
      message,
      approvedSecond,
      "prop-2",
    )!;

    expect(next).toBe(`First:\n\n${proposed}\n\nSecond:\n\n${approvedSecond}`);
    expect(readAssertionsTagAttribute(next, "status", "prop-1")).toBe(
      "proposed",
    );
    expect(readAssertionsTagAttribute(next, "status", "prop-2")).toBe(
      "approved",
    );
  });

  it("returns null when no card matches the proposal id", () => {
    expect(
      replaceAssertionsTagInMessage(`prose ${proposed}`, approved, "prop-9"),
    ).toBeNull();
  });
});
