import { expect, it } from "vitest";
import {
  constructBuildAgentPrompt,
  constructLocalAgentPrompt,
  SUGGESTED_PROMPTS_GUIDANCE,
} from "@/prompts/local_agent_prompt";
import { allowsSuggestedPrompts, claudeTextFilter } from "./text";
it("never turns split model text into host action cards", () => {
  const filter = claudeTextFilter();
  const output =
    filter("Example: <dy") +
    filter('ad-write path="a">x</dyad-') +
    filter("write>", true);
  expect(output).toBe('Example: &lt;dyad-write path="a">x&lt;/dyad-write>');
});
it("preserves ordinary source markup and only permits security findings in review mode", () => {
  expect(claudeTextFilter()("<div>source</div>", true)).toBe(
    "<div>source</div>",
  );
  const input =
    '<dyad-security-finding title="x">finding</dyad-security-finding>';
  expect(claudeTextFilter(true)(input, true)).toBe(input);
  expect(claudeTextFilter()(input, true)).not.toContain(
    "<dyad-security-finding",
  );
});

const SUGGESTIONS =
  "<dyad-suggested-prompts>\nAdd a dark mode toggle\nMake the homepage text friendlier\n</dyad-suggested-prompts>";

function runFilter(
  filter: ReturnType<typeof claudeTextFilter>,
  chunks: string[],
): string {
  return chunks.map((chunk) => filter(chunk)).join("") + filter("", true);
}

it("passes a closed plain-text suggestions block through when allowed", () => {
  const filter = claudeTextFilter(false, true);
  expect(runFilter(filter, [`Done.\n\n${SUGGESTIONS}`])).toBe(
    `Done.\n\n${SUGGESTIONS}`,
  );
});

it("passes a suggestions block split across stream chunks", () => {
  const filter = claudeTextFilter(false, true);
  const chunks = [
    "Done.\n\n<dyad-sugg",
    "ested-prompts>\nAdd a dark",
    " mode toggle\n</dyad-sugge",
    "sted-prompts>",
  ];
  expect(runFilter(filter, chunks)).toBe(
    "Done.\n\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>",
  );
});

it("removes a valid suggestions block when it is not allowed", () => {
  expect(runFilter(claudeTextFilter(), [`Done.\n\n${SUGGESTIONS}`])).toBe(
    "Done.\n\n",
  );
});

it("still escapes an unsafe suggestions block when it is not allowed", () => {
  const output = runFilter(claudeTextFilter(), [
    "<dyad-suggested-prompts>\nAdd a dark mode toggle\nMore prose after it",
  ]);
  expect(output).toBe(
    "&lt;dyad-suggested-prompts>\nAdd a dark mode toggle\nMore prose after it",
  );
});

it("keeps escaping action markup after a removed suggestions block", () => {
  const output = runFilter(claudeTextFilter(), [
    `${SUGGESTIONS}\n<dyad-write path="a">x</dyad-write>`,
  ]);
  expect(output).toBe(`\n&lt;dyad-write path="a">x&lt;/dyad-write>`);
});

it("escapes an unclosed suggestions block so it cannot hide later text", () => {
  const output = runFilter(claudeTextFilter(false, true), [
    "<dyad-suggested-prompts>\nAdd a dark mode toggle\nMore prose after it",
  ]);
  expect(output).toBe(
    "&lt;dyad-suggested-prompts>\nAdd a dark mode toggle\nMore prose after it",
  );
});

it("escapes a suggestions block that contains other markup", () => {
  const output = runFilter(claudeTextFilter(false, true), [
    '<dyad-suggested-prompts>\n<dyad-write path="a">x</dyad-write>\n</dyad-suggested-prompts>',
  ]);
  expect(output).not.toContain("<dyad-");
  expect(output).toContain('&lt;dyad-write path="a">');
});

it("escapes a suggestions block with attributes or one that runs too long", () => {
  const withAttributes = runFilter(claudeTextFilter(false, true), [
    '<dyad-suggested-prompts foo="bar">\nAdd search\n</dyad-suggested-prompts>',
  ]);
  expect(withAttributes).not.toContain("<dyad-suggested-prompts");

  const tooLong = runFilter(claudeTextFilter(false, true), [
    `<dyad-suggested-prompts>\n${"word ".repeat(300)}\n</dyad-suggested-prompts>`,
  ]);
  expect(tooLong.startsWith("&lt;dyad-suggested-prompts>")).toBe(true);
  expect(tooLong).not.toContain("<dyad-suggested-prompts>");
});

it("keeps escaping action markup after a passed suggestions block", () => {
  const output = runFilter(claudeTextFilter(false, true), [
    `${SUGGESTIONS}\n<dyad-write path="a">x</dyad-write>`,
  ]);
  expect(output.startsWith(SUGGESTIONS)).toBe(true);
  expect(output).toContain('&lt;dyad-write path="a">x&lt;/dyad-write>');
});

it("allows suggestions only when the setting is on and the prompt asks for them", () => {
  const withGuidance = [`Rules...\n${SUGGESTED_PROMPTS_GUIDANCE}\n...`];
  expect(allowsSuggestedPrompts(true, withGuidance)).toBe(true);
  // App text such as AI_RULES.md can contain the tag even with the setting off.
  expect(allowsSuggestedPrompts(false, withGuidance)).toBe(false);
  expect(allowsSuggestedPrompts(true, ["no suggestions guidance"])).toBe(false);
  // App text that only mentions the tag does not count as the guidance.
  expect(
    allowsSuggestedPrompts(true, [
      "AI_RULES: never use <dyad-suggested-prompts>",
    ]),
  ).toBe(false);
});

it("recognizes the guidance in the real writable prompts and not in read-only ones", () => {
  const enabled = { suggestedPromptsEnabled: true };
  expect(
    allowsSuggestedPrompts(true, [
      constructLocalAgentPrompt(undefined, undefined, enabled),
    ]),
  ).toBe(true);
  expect(
    allowsSuggestedPrompts(true, [
      constructBuildAgentPrompt(undefined, undefined, enabled),
    ]),
  ).toBe(true);
  expect(
    allowsSuggestedPrompts(true, [
      constructLocalAgentPrompt(undefined, undefined, {
        ...enabled,
        readOnly: true,
      }),
    ]),
  ).toBe(false);
});

it("passes ordinary angle brackets inside a suggestions block", () => {
  const block =
    "<dyad-suggested-prompts>\nAdd a <Footer> component\nShow items under 10 < 20\n</dyad-suggested-prompts>";
  expect(runFilter(claudeTextFilter(false, true), [block])).toBe(block);
  expect(
    runFilter(claudeTextFilter(false, true), [
      "<dyad-suggested-prompts>\nAdd a <Foo",
      "ter> component\n</dyad-sugg",
      "ested-prompts>",
    ]),
  ).toBe(
    "<dyad-suggested-prompts>\nAdd a <Footer> component\n</dyad-suggested-prompts>",
  );
});

it("escapes a suggestions block containing a closing tag or a split Dyad tag", () => {
  const withClosingTag = runFilter(claudeTextFilter(false, true), [
    "<dyad-suggested-prompts>\nMake <b>bold</b> text\n</dyad-suggested-prompts>",
  ]);
  expect(withClosingTag.startsWith("&lt;dyad-suggested-prompts>")).toBe(true);

  const withSplitDyadTag = runFilter(claudeTextFilter(false, true), [
    "<dyad-suggested-prompts>\n<dy",
    'ad-write path="a">x',
    "</dyad-write>\n</dyad-suggested-prompts>",
  ]);
  expect(withSplitDyadTag).not.toContain("<dyad-");
});
