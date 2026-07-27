import crypto from "node:crypto";
import { z } from "zod";
import log from "electron-log";

import { ToolDefinition, AgentContext } from "./types";
import { completeWarning } from "./run_tests_utils";
import {
  hashSpecSource,
  loadSpecForAssertions,
} from "@/ipc/handlers/test_assertion_handlers";
import {
  isSingleAssertionStatement,
  type ParsedSpec,
} from "@/lib/test_recorder/spec_edit";
import {
  ASSERTION_PROPOSAL_VERSION,
  buildPlanItems,
  countAssertions,
  type AssertionProposalPayload,
} from "@/lib/test_recorder/assertion_proposal";
import { buildAssertionsTagContent } from "@/lib/test_recorder/assertion_tag";
import { E2E_TEST_DIR } from "@/ipc/types/tests";

const logger = log.scope("generate_test_assertions");

const generateTestAssertionsSchema = z.object({
  specPath: z
    .string()
    .min(1)
    .describe(
      `App-relative path of the recorded spec to annotate, e.g. "${E2E_TEST_DIR}/recorded-add-item.spec.ts". Must be a spec you have just read with read_file.`,
    ),
  steps: z
    .array(
      z.object({
        index: z
          .number()
          .int()
          .nonnegative()
          .describe(
            "0-based index of the statement in the test body, counting only non-blank statement lines between the test( line and the closing });.",
          ),
        text: z
          .string()
          .min(1)
          .describe(
            'One short present-tense sentence describing what the user did: "Click the Increment button", \'Type "Ada" into the Name field\'. No Playwright, locators, or code.',
          ),
      }),
    )
    .describe(
      "One entry per statement in the test body, in order. Describe EVERY statement — a statement you skip is shown to the user as its raw code.",
    ),
  assertions: z
    .array(
      z.object({
        afterStep: z
          .number()
          .int()
          .min(-1)
          .describe(
            "0-based index of the statement this assertion goes AFTER. Use -1 to place it before the first statement (rare).",
          ),
        text: z
          .string()
          .min(1)
          .describe(
            'The assertion as one plain-English sentence: "The counter shows 1."',
          ),
        code: z
          .string()
          .min(1)
          .describe(
            "The Playwright check: exactly ONE statement, on ONE line, starting with `await expect(` and ending with `;`. No comments, no test.step, no awaits other than the leading one.",
          ),
      }),
    )
    .describe(
      "The assertions to propose. An empty array is a valid answer for a flow with no meaningful outcome to check.",
    ),
});

type GenerateTestAssertionsArgs = z.infer<typeof generateTestAssertionsSchema>;

const DESCRIPTION = `Propose assertions for a recorded Playwright test and show them to the user as a reviewable card, where they can edit, delete, reorder, and approve them. Dyad splices the approved assertions into the spec itself — you never rewrite the file.

<when_to_use>
Use this when the user asks to add assertions to (or "enhance" / "improve") a test they recorded with the recorder — a spec under ${E2E_TEST_DIR}/ that is just a flat list of recorded interactions. Do NOT use it to write a new test from scratch (write the spec with write_file instead), and do NOT use it on a hand-written spec: this tool only accepts specs in the recorder's shape (one single-line statement per line, one test() block) and will tell you if the spec doesn't qualify.
</when_to_use>

<how_to_use>
1. read_file the spec FIRST. You must see its exact statements — the indices you send are positions in that file.
2. Number the body statements from 0, counting only the non-blank statement lines between the \`test(\` line and the closing \`});\`. Skip nothing: a comment or blank line is not a statement, but every real statement counts.
3. Send one \`steps\` entry per statement, plus the assertions you want to propose.
4. Stop after the call. Do NOT edit the spec, and do NOT call run_tests — the user reviews the card and Dyad writes the file when they approve. Just tell them the card is ready.
</how_to_use>

<assertions>
BE CONSERVATIVE. Most recorded tests need one to three assertions. Many need zero.
- Assert only an OUTCOME the preceding statements should have produced.
- Never invent text, URLs, counts, roles, or test ids that don't already appear in the spec. If you can't ground it, don't propose it.
- Never assert that an element you just interacted with exists.
- Don't assert after \`signIn(page)\` or \`page.goto(...)\` unless navigation is the point of the flow.
- At most one assertion per statement.
- Prefer web-first assertions: expect(locator).toBeVisible() / .toHaveText() / .toHaveValue() / .toBeChecked(), and expect(page).toHaveURL().
- Reuse the exact locator chain from a nearby statement wherever possible.
</assertions>

<correct_example>
For a spec whose body is:
  0: await page.goto("/");
  1: await page.getByRole("button", { name: "Increment" }).click();

{
  "specPath": "${E2E_TEST_DIR}/recorded-counter.spec.ts",
  "steps": [
    { "index": 0, "text": "Open the home page" },
    { "index": 1, "text": "Click the Increment button" }
  ],
  "assertions": [
    {
      "afterStep": 1,
      "text": "The counter shows 1",
      "code": "await expect(page.getByTestId(\\"count\\")).toHaveText(\\"1\\");"
    }
  ]
}
</correct_example>`;

/**
 * Validate the model's plan against the spec we actually parsed, and report
 * every problem at once so one retry can fix them all.
 *
 * Nothing is clamped or silently dropped: a wrong index means the model wasn't
 * looking at the statement we think it was, and attaching an assertion to the
 * wrong step is worse than asking again.
 */
function collectProblems({
  args,
  statementCount,
}: {
  args: GenerateTestAssertionsArgs;
  statementCount: number;
}): string[] {
  const problems: string[] = [];
  const lastIndex = statementCount - 1;

  const badStepIndexes = args.steps
    .map((step) => step.index)
    .filter((index) => index > lastIndex);
  if (badStepIndexes.length > 0) {
    problems.push(
      `steps reference statement index ${badStepIndexes.join(", ")}, but the body has ${statementCount} statement(s) (valid indices 0-${lastIndex}).`,
    );
  }

  const describedIndexes = new Set(args.steps.map((step) => step.index));
  const missing = Array.from(
    { length: statementCount },
    (_, index) => index,
  ).filter((index) => !describedIndexes.has(index));
  if (missing.length > 0) {
    problems.push(
      `no step description for statement index ${missing.join(", ")} — describe every statement.`,
    );
  }

  args.assertions.forEach((assertion, position) => {
    if (assertion.afterStep > lastIndex) {
      problems.push(
        `assertion ${position + 1} ("${assertion.text}") has afterStep ${assertion.afterStep}, but valid values are -1 to ${lastIndex}.`,
      );
    }
    if (!isSingleAssertionStatement(assertion.code)) {
      problems.push(
        `assertion ${position + 1} ("${assertion.text}") has code that isn't a single \`await expect(...);\` statement on one line: ${assertion.code}`,
      );
    }
  });

  return problems;
}

export const generateTestAssertionsTool: ToolDefinition<GenerateTestAssertionsArgs> =
  {
    name: "generate_test_assertions",
    description: DESCRIPTION,
    inputSchema: generateTestAssertionsSchema,
    defaultConsent: "always",
    // Approving the card writes the spec, so keep this out of read-only and
    // plan modes alongside the other file-changing tools.
    modifiesState: true,
    isEnabled: (ctx) => ctx.testingEnabled,

    getConsentPreview: (args) =>
      `Propose ${args.assertions.length} assertion(s) for ${args.specPath}`,

    execute: async (args, ctx: AgentContext) => {
      let source: string;
      let parsed: ParsedSpec;
      try {
        ({ source, parsed } = await loadSpecForAssertions({
          appId: ctx.appId,
          specPath: args.specPath,
        }));
      } catch (error) {
        const body = `Couldn't propose assertions for ${args.specPath}: ${
          error instanceof Error ? error.message : String(error)
        }\n\nNothing was shown to the user and the file was not touched. If the spec isn't in the recorder's shape, edit it directly with search_replace instead.`;
        completeWarning(ctx, `Can't annotate ${args.specPath}`, body);
        return body;
      }

      if (parsed.bodyStatements.length === 0) {
        const body = `${args.specPath} has no statements in its test body, so there is nothing to assert on.`;
        completeWarning(ctx, `Nothing to assert in ${args.specPath}`, body);
        return body;
      }

      const problems = collectProblems({
        args,
        statementCount: parsed.bodyStatements.length,
      });
      if (problems.length > 0) {
        const body = [
          `Your plan doesn't line up with ${args.specPath}, so nothing was shown to the user:`,
          ...problems.map((problem) => `- ${problem}`),
          "",
          "The statements, numbered as this tool counts them:",
          ...parsed.bodyStatements.map(
            (statement, index) => `${index}: ${statement}`,
          ),
          "",
          "Call generate_test_assertions again with indices that match this list.",
        ].join("\n");
        completeWarning(ctx, `Assertion plan rejected`, body);
        return body;
      }

      const { items } = buildPlanItems({
        bodyStatements: parsed.bodyStatements,
        stepDescriptions: args.steps,
        assertions: args.assertions.map((assertion) => ({
          afterStep: assertion.afterStep,
          text: assertion.text,
          code: assertion.code.trim(),
        })),
        newId: () => crypto.randomUUID(),
      });

      const proposalId = crypto.randomUUID();
      const payload: AssertionProposalPayload = {
        version: ASSERTION_PROPOSAL_VERSION,
        appId: ctx.appId,
        specPath: args.specPath,
        testTitle: parsed.testTitle,
        specHash: hashSpecSource(source),
        items,
      };

      ctx.onXmlComplete(
        buildAssertionsTagContent({
          proposalId,
          status: "proposed",
          payload,
        }),
      );

      const assertionCount = countAssertions(items);
      logger.info(
        `Proposed ${assertionCount} assertion(s) for ${args.specPath} (chat ${ctx.chatId})`,
      );
      return `Showed the user a review card for ${args.specPath} with ${parsed.bodyStatements.length} step(s) and ${assertionCount} proposed assertion(s).

The card is now theirs to work with: they can edit the wording, delete assertions, add their own, reorder them, and approve. Dyad writes the approved assertions into the spec when they hit Approve — the file is UNCHANGED until then.

You are done with this request. Do NOT edit ${args.specPath}, do NOT propose the same assertions again, and do NOT run the test. Reply with one short sentence telling the user the assertions are ready for review.`;
    },
  };
