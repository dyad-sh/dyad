import { describe, expect, it } from "vitest";

import { parseFullMessage } from "../streamingMessageParser";
import {
  ASSERTIONS_TAG,
  buildAssertionsTagContent,
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

  it("round-trips on the main-process side too", () => {
    expect(parseAssertionsPayloadFromMessage(content)).toEqual(PAYLOAD);
    expect(readAssertionsTagAttribute(content, "status")).toBe("proposed");
    expect(readAssertionsTagAttribute(content, "proposal-id")).toBe("prop-1");
  });

  it("reflects the approved latch", () => {
    const approved = buildAssertionsTagContent({
      proposalId: "prop-1",
      status: "approved",
      payload: PAYLOAD,
    });
    expect(readAssertionsTagAttribute(approved, "status")).toBe("approved");
  });

  it("carries an empty spec-path while no file has been generated", () => {
    const pending = buildAssertionsTagContent({
      proposalId: "prop-1",
      status: "proposed",
      payload: { ...PAYLOAD, specPath: null },
    });
    expect(readAssertionsTagAttribute(pending, "spec-path")).toBe("");
    expect(parseAssertionsPayloadFromMessage(pending)?.specPath).toBeNull();
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

  it("returns null when the message has no card to replace", () => {
    expect(replaceAssertionsTagInMessage("just prose", approved)).toBeNull();
  });
});

describe("parseAssertionsPayload", () => {
  it("returns null instead of throwing on unusable content", () => {
    expect(parseAssertionsPayload("")).toBeNull();
    expect(parseAssertionsPayload("not json")).toBeNull();
    expect(parseAssertionsPayload(`{"version":2}`)).toBeNull();
  });

  it("returns null when the message has no tag at all", () => {
    expect(parseAssertionsPayloadFromMessage("just some text")).toBeNull();
    expect(readAssertionsTagAttribute("just some text", "status")).toBeNull();
  });
});
