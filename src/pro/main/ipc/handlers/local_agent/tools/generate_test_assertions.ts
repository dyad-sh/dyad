import crypto from "node:crypto";
import { z } from "zod";
import log from "electron-log";

import { ToolDefinition, AgentContext } from "./types";
import { completeWarning } from "./run_tests_utils";
import { getRecordedTestDraft } from "@/ipc/services/recorded_test_drafts";
import { recordedBodyStatements } from "@/lib/test_recorder/codegen";
import { isSingleAssertionStatement } from "@/lib/test_recorder/assertion_code";
import {
  ASSERTION_PROPOSAL_VERSION,
  buildPlanItems,
  countAssertions,
  type AssertionProposalPayload,
} from "@/lib/test_recorder/assertion_proposal";
import { buildAssertionsTagContent } from "@/lib/test_recorder/assertion_tag";

const logger = log.scope("generate_test_assertions");

const generateTestAssertionsSchema = z.object({
  steps: z
    .array(
      z.object({
        index: z
          .number()
          .int()
          .nonnegative()
          .describe(
            "0-based index of the statement, exactly as numbered in the list of recorded statements you were given.",
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
      "One entry per recorded statement, in order. Describe EVERY statement — a statement you skip is shown to the user as its raw code.",
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

const NO_DRAFT_MESSAGE = `There is no finished recording waiting for assertions, so nothing was shown to the user and no file was touched.

This tool only works right after the user stops a recording and clicks "Generate assertions" in the recorder bar — it reads the recording Dyad parked at that moment. Tell the user to record the flow in the preview and click "Generate assertions"; to add assertions to a spec that already exists on disk, edit it with search_replace instead.`;

const DESCRIPTION = `Turn a just-finished recording into a reviewable plan: describe each recorded step in plain English and propose the assertions that should check it. The user reviews the plan in a chat card — editing, deleting, reordering — and Dyad generates the test file from it when they approve. You never write the spec.

<when_to_use>
Use this when the user asks for assertions for a flow they just recorded with Dyad's recorder. The recorded statements are given to you in the request — the test does NOT exist as a file yet, and there is nothing to read_file. Do NOT use it to write a new test from scratch (write the spec with write_file instead), and do NOT use it on a spec that already exists on disk (edit that with search_replace).
</when_to_use>

<how_to_use>
1. Read the numbered statements in the user's message. Those indices are the ones this tool expects — don't renumber them.
2. Send one \`steps\` entry per statement, translating it into one plain-English sentence, plus the assertions you want to propose.
3. Stop after the call. The file does not exist yet: there is nothing to edit and nothing to run. The user reviews the card, and Dyad generates the spec when they approve. Just tell them the plan is ready.
</how_to_use>

<assertions>
BE CONSERVATIVE. Most recorded tests need one to three assertions. Many need zero.
- Assert only an OUTCOME the preceding statements should have produced.
- Never invent text, URLs, counts, roles, or test ids that don't already appear in the statements. If you can't ground it, don't propose it.
- Never assert that an element you just interacted with exists.
- Don't assert after \`signIn(page)\` or \`page.goto(...)\` unless navigation is the point of the flow.
- At most one assertion per statement.
- Prefer web-first assertions: expect(locator).toBeVisible() / .toHaveText() / .toHaveValue() / .toBeChecked(), and expect(page).toHaveURL().
- Reuse the exact locator chain from a nearby statement wherever possible.
</assertions>

<correct_example>
For a recording whose statements are:
  0: await page.goto("/");
  1: await page.getByRole("button", { name: "Increment" }).click();

{
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
 * Validate the model's plan against the recording we actually have, and report
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
      `steps reference statement index ${badStepIndexes.join(", ")}, but the recording has ${statementCount} statement(s) (valid indices 0-${lastIndex}).`,
    );
  }

  // Every index covered isn't enough: two descriptions for the same statement
  // means one of them is silently discarded, and the card would then show a
  // plan the model didn't actually write. Ask again instead.
  const stepIndexes = args.steps.map((step) => step.index);
  const duplicateIndexes = Array.from(
    new Set(
      stepIndexes.filter(
        (index, position) => stepIndexes.indexOf(index) !== position,
      ),
    ),
  );
  if (duplicateIndexes.length > 0) {
    problems.push(
      `multiple step descriptions for statement index ${duplicateIndexes.join(", ")} — describe each statement exactly once.`,
    );
  }

  const describedIndexes = new Set(stepIndexes);
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
    // Approving the card generates the spec file, so keep this out of read-only
    // and plan modes alongside the other file-changing tools.
    modifiesState: true,
    isEnabled: (ctx) => ctx.testingEnabled,

    getConsentPreview: (args) =>
      `Propose ${args.assertions.length} assertion(s) for the recorded test`,

    execute: async (args, ctx: AgentContext) => {
      const draft = getRecordedTestDraft(ctx.appId);
      if (!draft) {
        completeWarning(ctx, "No recording to annotate", NO_DRAFT_MESSAGE);
        return NO_DRAFT_MESSAGE;
      }

      const bodyStatements = recordedBodyStatements(draft);
      const problems = collectProblems({
        args,
        statementCount: bodyStatements.length,
      });
      if (problems.length > 0) {
        const body = [
          `Your plan doesn't line up with the recording, so nothing was shown to the user:`,
          ...problems.map((problem) => `- ${problem}`),
          "",
          "The recorded statements, numbered as this tool counts them:",
          ...bodyStatements.map((statement, index) => `${index}: ${statement}`),
          "",
          "Call generate_test_assertions again with indices that match this list.",
        ].join("\n");
        completeWarning(ctx, `Assertion plan rejected`, body);
        return body;
      }

      const { items } = buildPlanItems({
        bodyStatements,
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
        // The whole recording rides along, so approving still works after a
        // restart and never depends on a file that doesn't exist yet.
        draft,
        testTitle: draft.testName,
        specPath: null,
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
        `Proposed ${assertionCount} assertion(s) for recorded test "${draft.testName}" (chat ${ctx.chatId})`,
      );
      return `Showed the user a review card for the recorded test "${draft.testName}" with ${bodyStatements.length} step(s) and ${assertionCount} proposed assertion(s).

The card is now theirs to work with: they can edit the wording, delete assertions, add their own, reorder them, and approve. Dyad generates the spec file — steps and approved assertions — when they hit Approve. NOTHING is on disk until then.

You are done with this request. There is no file to edit and no test to run yet. Do NOT propose the same assertions again, and do NOT call run_tests. Reply with one short sentence telling the user the plan is ready for review.`;
    },
  };
