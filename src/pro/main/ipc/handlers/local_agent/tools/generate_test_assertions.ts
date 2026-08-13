import crypto from "node:crypto";
import { z } from "zod";
import log from "electron-log";

import { ToolDefinition, AgentContext } from "./types";
import { completeWarning } from "./run_tests_utils";
import { userInputRegistry } from "@/user_input/main";
import { broadcastToAllWindows } from "@/ipc/utils/window_broadcast";
import {
  getRecordedTestDraft,
  setRecordedTestDraft,
} from "@/ipc/services/recorded_test_drafts";
import { recordedBodyStatements } from "@/lib/test_recorder/codegen";
import {
  MAX_TEST_NAME_LENGTH,
  normalizeTestName,
  type RecordedTestDraft,
} from "@/lib/test_recorder/draft";
import { isSingleAssertionStatement } from "@/lib/test_recorder/assertion_code";
import {
  ASSERTION_PROPOSAL_VERSION,
  buildPlanItems,
  countAssertions,
  MAX_ASSERTION_CODE_LENGTH,
  MAX_ASSERTION_TEXT_LENGTH,
  type AssertionProposalPayload,
} from "@/lib/test_recorder/assertion_proposal";
import { buildAssertionsTagContent } from "@/lib/test_recorder/assertion_tag";
import {
  applyRecordedSelectorRepairs,
  RecordedSelectorRepairSchema,
} from "@/lib/test_recorder/selector_repair";

const logger = log.scope("generate_test_assertions");

const generateTestAssertionsSchema = z.object({
  recordingId: z
    .string()
    .min(1)
    .describe(
      "The recording id given in the request, copied exactly. It names which recording these steps describe.",
    ),
  testName: z
    .string()
    .min(1)
    .max(MAX_TEST_NAME_LENGTH)
    .describe(
      'What this test should be called: a short sentence-case phrase naming the flow it exercises, from what the steps actually do — "Add an item to the list", "Sign in and open settings". No file extension, no "test" or "spec" in it. It becomes the Playwright test title and, slugified, the file name. If the request says the user chose a name, send that name exactly.',
    ),
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
          // Bounded to the same limit the plan the card renders enforces, so a
          // runaway description is rejected here — with a retry the model can
          // act on — rather than at payload validation, where the card is gone.
          .max(MAX_ASSERTION_TEXT_LENGTH)
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
          .max(MAX_ASSERTION_TEXT_LENGTH)
          .describe(
            'The assertion as one plain-English sentence: "The counter shows 1."',
          ),
        code: z
          .string()
          .min(1)
          .max(MAX_ASSERTION_CODE_LENGTH)
          .describe(
            "The Playwright check: exactly ONE statement, on ONE line, starting with `await expect(` and ending with `;`. No comments, no test.step, no awaits other than the leading one.",
          ),
      }),
    )
    .describe(
      "The assertions to propose. An empty array is a valid answer for a flow with no meaningful outcome to check.",
    ),
  selectorRepairs: z
    .array(RecordedSelectorRepairSchema)
    .max(5_000)
    .optional()
    .describe(
      "Fragile recorded CSS locators whose app source you already edited to add or reuse the given data-testid. Omit this field when no safe repair was completed. Never claim a repair before the source edit succeeds.",
    ),
});

type GenerateTestAssertionsArgs = z.infer<typeof generateTestAssertionsSchema>;

const NO_DRAFT_MESSAGE = `There is no finished recording waiting to become a test, so nothing was shown to the user and no file was touched.

This tool only works right after the user stops a recording and clicks "Generate test proposal" in the recorder bar — it reads the recording Dyad parked at that moment. Tell the user to record the flow in the preview and click "Generate test proposal"; to add assertions to a spec that already exists on disk, edit it with search_replace instead.`;

const STALE_DRAFT_MESSAGE = (
  currentId: string,
) => `The recording id you sent doesn't match the recording waiting for assertions, so nothing was shown to the user and no file was touched. The user recorded something else while this request was queued.

Do NOT resend the same steps against the new id — they describe a flow that is no longer the one waiting. Ask the user whether they want assertions for the recording they just finished (id \`${currentId}\`); if they do, they should ask again so you get its statements.`;

const DESCRIPTION = `Turn a just-finished recording into a reviewable test proposal: name the test, describe each recorded step in plain English, and propose the assertions that should check it. The user reviews the proposal in a chat card — editing, deleting, reordering — and Dyad generates the test file from it when they approve. You never write the spec.

This tool BLOCKS until the user answers the card, then tells you what happened. The turn is not over when you call it.

<when_to_use>
Use this when the user asks for assertions for a flow they just recorded with Dyad's recorder. The recorded statements are given to you in the request — the test does NOT exist as a file yet, and there is nothing to read_file. Do NOT use it to write a new test from scratch (write the spec with write_file instead), and do NOT use it on a spec that already exists on disk (edit that with search_replace).
</when_to_use>

<how_to_use>
1. Read the numbered statements in the user's message. Those indices are the ones this tool expects — don't renumber them.
2. If the request lists fragile selectors, inspect each source hint before calling this tool. For every element you can identify safely, reuse an existing data-testid or edit the app source to add a descriptive static kebab-case data-testid. Do not guess when the hint is missing or ambiguous, and do not put one static id on repeated list items.
3. Send a \`testName\` for the flow, one \`steps\` entry per statement translating it into one plain-English sentence, plus the assertions you want to propose. Include one \`selectorRepairs\` entry per source edit that succeeded, copying its recorded action index and original CSS exactly. Copy the recording id from the request into \`recordingId\` exactly — it ties the plan and repairs to the recording they describe.
4. Wait. The call does not come back until the user approves the card or closes it, and the tool result tells you which. Do NOT call it a second time, and do NOT try to write or run anything while it is open — the spec does not exist yet.
5. Do what the tool result says: run the spec it names, or stop if the user closed the card.
</how_to_use>

<selector_repairs>
- A repair is valid only after you have confirmed and, when needed, edited the corresponding app source. The tool updates the recorded draft; it does not edit source code for you.
- Use the recorded ACTION index shown in the fragile-selector details, not the displayed statement index. Setup statements such as signIn and page.goto are not recorded actions.
- One repair updates every recorded action with the same original CSS. Do not send duplicates.
- If you cannot make a safe source edit, omit the repair. Keeping the original CSS is better than changing the wrong element.
</selector_repairs>

<assertions>
BE CONSERVATIVE. Most recorded tests need one to three assertions. Many need zero.
- Assert only an OUTCOME the preceding statements should have produced.
- Never invent text, URLs, counts, roles, or test ids that don't already appear in the statements, except a test id from a completed \`selectorRepairs\` source edit. If you can't ground it, don't propose it.
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
  "testName": "Increment the counter",
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
 * Validate the model's plan against the recording we actually have, reporting
 * every problem at once so one retry fixes them all. Nothing is clamped or
 * silently dropped — attaching an assertion to the wrong step is worse than
 * asking again.
 */
function collectProblems({
  args,
  statementCount,
  needsName,
}: {
  args: GenerateTestAssertionsArgs;
  statementCount: number;
  /** The user left the recording unnamed, so this plan's name is the only one. */
  needsName: boolean;
}): string[] {
  const problems: string[] = [];
  const lastIndex = statementCount - 1;

  // Asking again costs one call; accepting it would name the user's test — and
  // its file — "recorded test", which is the whole reason the model is asked.
  if (needsName && !normalizeTestName(args.testName)) {
    problems.push(
      `testName is empty. The user didn't name this recording, so your name is the one the test and its file get — send a short phrase describing what the steps do.`,
    );
  }

  const badStepIndexes = args.steps
    .map((step) => step.index)
    .filter((index) => index > lastIndex);
  if (badStepIndexes.length > 0) {
    problems.push(
      `steps reference statement index ${badStepIndexes.join(", ")}, but the recording has ${statementCount} statement(s) (valid indices 0-${lastIndex}).`,
    );
  }

  // Every index covered isn't enough: two descriptions for one statement means
  // one is silently discarded, and the card would show a plan the model didn't
  // write.
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
      `Propose "${normalizeTestName(args.testName)}" with ${args.assertions.length} assertion(s)`,

    execute: async (args, ctx: AgentContext) => {
      const draft = getRecordedTestDraft(ctx.appId);
      if (!draft) {
        completeWarning(ctx, "No recording to annotate", NO_DRAFT_MESSAGE);
        return NO_DRAFT_MESSAGE;
      }
      // The parked draft is whatever the app recorded *most recently*, and this
      // call can be queued behind another turn: long enough for the user to
      // dismiss this review, record something else, and have that replace it.
      // Annotating the newer recording with these descriptions would generate a
      // test that describes one flow and replays another — and a matching
      // statement count is all it takes for the checks below to wave it through.
      if (args.recordingId !== draft.draftId) {
        const body = STALE_DRAFT_MESSAGE(draft.draftId);
        completeWarning(ctx, "Assertion plan rejected", body);
        return body;
      }

      const repairResult = applyRecordedSelectorRepairs({
        draft,
        repairs: args.selectorRepairs ?? [],
      });
      const repairedDraft = repairResult.draft;
      const bodyStatements = recordedBodyStatements(repairedDraft);
      const userName = normalizeTestName(draft.testName);
      const problems = [
        ...repairResult.problems,
        ...collectProblems({
          args,
          statementCount: bodyStatements.length,
          needsName: !userName,
        }),
      ];
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

      // The user's own name always wins; the model's is what names the test
      // when they left it to us, which is the usual case. The fallback is
      // unreachable — an empty name for an unnamed recording was rejected
      // above — and exists so nothing downstream can be handed an unnamed test.
      const testName =
        userName || normalizeTestName(args.testName) || "recorded test";
      const namedDraft: RecordedTestDraft = { ...repairedDraft, testName };

      // The recorder bar is still showing this recording, under the name it had
      // when the session stopped — which for an unnamed one is "Untitled
      // recording". Tell it the name the test is actually being proposed under,
      // so the bar and the card below it don't disagree about what this is.
      // Broadcast rather than replied: this tool has no originating sender, and
      // the bar can be in any window.
      setRecordedTestDraft(ctx.appId, namedDraft);
      broadcastToAllWindows("recording:draft-named", {
        appId: ctx.appId,
        draftId: namedDraft.draftId,
        testName,
        // Keep the recorder bar's renderer copy in sync without broadcasting
        // the recording's fill values. If the card is closed and the user asks
        // again, its next prompt must not resend the old CSS paths.
        selectorRepairs: args.selectorRepairs,
      });

      const proposalId = crypto.randomUUID();
      const payload: AssertionProposalPayload = {
        version: ASSERTION_PROPOSAL_VERSION,
        appId: ctx.appId,
        // The whole recording rides along — under the name it will be written
        // with — so approving still works after a restart and never depends on
        // a file that doesn't exist yet.
        draft: namedDraft,
        testTitle: testName,
        specPath: null,
        items,
      };

      // Requested before the card is committed: the card carries this id, and
      // answering it is the only thing that resumes this call.
      const requestId = userInputRegistry.request({
        kind: "test-assertions",
        chatId: ctx.chatId,
        appId: ctx.appId,
        proposalId,
        testTitle: testName,
        classifier: "none",
      });

      ctx.onXmlComplete(
        buildAssertionsTagContent({
          proposalId,
          requestId,
          status: "proposed",
          payload,
        }),
      );

      const assertionCount = countAssertions(items);
      logger.info(
        `Proposed ${assertionCount} assertion(s) for recorded test "${testName}" after repairing ${repairResult.repairedActionCount} action locator(s) (chat ${ctx.chatId}), awaiting review as ${requestId}`,
      );

      const result = await userInputRegistry.park(requestId, ctx.abortSignal);
      const review = result?.kind === "test-assertions" ? result : null;

      // Approving rewrote this card's tag in the message row to latch it
      // approved. That row is the same one this turn keeps appending to, so
      // adopt the rewrite before writing anything else over it.
      await ctx.resyncResponseFromDb?.();

      if (!review?.specPath) {
        logger.info(
          `Assertion review ${requestId} ended without a spec for "${testName}"`,
        );
        return `The user closed the review card without approving it, so no test file was written.

Do NOT call generate_test_assertions again for this recording and do NOT call run_tests — there is nothing on disk to run, and approving a proposal is the only thing that writes one. Ask them what they'd like to do instead, in one short sentence.`;
      }

      logger.info(
        `Assertion review ${requestId} approved: generated ${review.specPath}`,
      );
      return `The user approved the plan. Dyad generated ${review.specPath} from the recording, with ${review.appliedCount} assertion(s). It is on disk now.

A recorded test nobody has run is a guess — replay can behave differently from the hand-performed flow. Run ${review.specPath} with run_tests. If it fails, read the failure, decide whether the test or the app is wrong, fix it, and run it again until it passes — or tell the user what's blocking it.`;
    },
  };
