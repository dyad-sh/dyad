import { describe, expect, it } from "vitest";

import { buildRecordedTestProposalPrompt } from "./assertion_request";
import { RECORDED_TEST_DRAFT_VERSION, type RecordedTestDraft } from "./draft";

describe("buildRecordedTestProposalPrompt", () => {
  it("gives the agent action indices and source hints for fragile selectors", () => {
    const draft: RecordedTestDraft = {
      version: RECORDED_TEST_DRAFT_VERSION,
      draftId: "recording-1",
      authMode: "neon-better-auth",
      actions: [
        {
          kind: "fill",
          value: "2026-08-13",
          locator: {
            kind: "css",
            value: "#root > main > form > div:nth-of-type(2) > input",
            sourceHint: {
              relativePath: "src/components/EventForm.tsx",
              line: 84,
              column: 10,
              tagName: "input",
              inputType: "date",
              exact: true,
            },
          },
        },
      ],
    };

    const prompt = buildRecordedTestProposalPrompt(draft);

    // signIn + goto occupy statements 0 and 1, but the tool repair indexes the
    // underlying recorded action independently.
    expect(prompt).toContain("Statement 2; recorded action 0");
    expect(prompt).toContain('"file":"src/components/EventForm.tsx"');
    expect(prompt).toContain('"inputType":"date"');
    expect(prompt).toContain("include one selectorRepairs entry");
    expect(prompt).toContain("do not guess");
  });

  it("does not add stabilization instructions for stable locators", () => {
    const draft: RecordedTestDraft = {
      version: RECORDED_TEST_DRAFT_VERSION,
      draftId: "recording-2",
      authMode: "none",
      actions: [
        {
          kind: "click",
          locator: { kind: "role", value: "button", name: "Save" },
        },
      ],
    };

    const prompt = buildRecordedTestProposalPrompt(draft);

    expect(prompt).not.toContain("Fragile selectors to stabilize");
    expect(prompt).toContain("any completed selector repairs");
  });
});
