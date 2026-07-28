import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { streamText } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "../../db";
import { apps, chats, messages } from "../../db/schema";
import { getDyadAppPath } from "../../paths/paths";
import { createTypedHandler } from "./base";
import { E2E_TEST_DIR, testsContracts } from "../types/tests";
import type {
  ApplyTestAssertionsResult,
  CreateRecordedSpecResult,
} from "../types/tests";
import { assertMutationPathAllowed } from "../utils/path_utils";
import { gitAdd } from "../utils/git_utils";
import { extractJson } from "../utils/extract_json";
import { getModelClient } from "../utils/get_model_client";
import { fastTextOutput } from "../utils/stream_text_utils";
import { getAiHeaders, getProviderOptions } from "../utils/provider_options";
import { clearRecordedTestDraft } from "../services/recorded_test_drafts";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  countAssertions,
  isAssertionItem,
  type AssertionPlanItem,
} from "@/lib/test_recorder/assertion_proposal";
import {
  draftIncludesSignIn,
  type RecordedTestDraft,
} from "@/lib/test_recorder/draft";
import {
  generateSpecSource,
  recordedBodyStatements,
  recordedSpecFileName,
} from "@/lib/test_recorder/codegen";
import { generateTestUserFixtureSource } from "@/lib/test_recorder/fixture_templates";
import { isSingleAssertionStatement } from "@/lib/test_recorder/assertion_code";
import {
  ASSERTIONS_TAG,
  buildAssertionsTagContent,
  parseAssertionsPayloadFromMessage,
  readAssertionsTagAttribute,
  replaceAssertionsTagInMessage,
} from "@/lib/test_recorder/assertion_tag";
import {
  buildAssertionCodePayload,
  TEST_ASSERTION_CODE_SYSTEM_PROMPT,
} from "@/prompts/test_assertions_prompt";

/**
 * Writing a recorded test to disk.
 *
 * The recorder stops with a draft, never a file. Both ways of turning that
 * draft into a spec — approving the assertion card, or saving the recording
 * as-is — land here and go through the same deterministic codegen, so what the
 * user reviewed is exactly what gets written. A model is only ever asked for
 * the text of an assertion, never for the file.
 */

const logger = log.scope("test_assertion_handlers");

const LLM_TIMEOUT_MS = 60_000;

const FIXTURE_PATH = `${E2E_TEST_DIR}/fixtures/test-user.ts`;

/** How many `recorded-<slug>-N.spec.ts` variants to try before giving up. */
const MAX_SPEC_NAME_ATTEMPTS = 100;

const rawCodeSchema = z.object({
  assertions: z
    .array(z.object({ id: z.string(), code: z.string() }))
    .default([]),
});

async function getAppPath(appId: number): Promise<string> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) {
    throw new DyadError(`App ${appId} not found`, DyadErrorKind.NotFound);
  }
  return getDyadAppPath(app.path);
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.promises.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

/** Best-effort staging for the uncommitted-changes review flow. */
async function stage(appPath: string, relativePath: string): Promise<void> {
  try {
    await gitAdd({ path: appPath, filepath: relativePath });
  } catch (error) {
    logger.warn(`Wrote ${relativePath} but couldn't git-add it:`, error);
  }
}

/**
 * Write the `signIn` helper the generated spec imports, unless the app already
 * has one — never overwrite the user's edits to it.
 */
async function ensureSignInFixture(
  appPath: string,
  draft: RecordedTestDraft,
): Promise<void> {
  if (draft.authMode === "none") return;
  const relativePath = await assertMutationPathAllowed({
    appPath,
    relativePath: FIXTURE_PATH,
  });
  const absolutePath = path.join(appPath, relativePath);
  if (await fileExists(absolutePath)) return;
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(
    absolutePath,
    generateTestUserFixtureSource(draft.authMode),
    "utf-8",
  );
  await stage(appPath, relativePath);
}

/**
 * Claim a free `e2e-tests/recorded-<slug>.spec.ts`. A re-recording, a second
 * flow whose name slugifies the same, or repeated blank-name saves must never
 * clobber a spec that already exists — disambiguate with a numeric suffix.
 */
async function resolveSpecPath(
  appPath: string,
  testName: string,
): Promise<{ relativePath: string; absolutePath: string }> {
  for (let index = 1; index <= MAX_SPEC_NAME_ATTEMPTS; index++) {
    const candidate = `${E2E_TEST_DIR}/${recordedSpecFileName(testName, index)}`;
    // Re-validated per candidate: the name is derived from user input, and this
    // is the only thing standing between it and a write outside the app.
    const relativePath = await assertMutationPathAllowed({
      appPath,
      relativePath: candidate,
    });
    if (!(await fileExists(path.join(appPath, relativePath)))) {
      return { relativePath, absolutePath: path.join(appPath, relativePath) };
    }
  }
  throw new DyadError(
    `Couldn't find a free filename for "${testName}" under ${E2E_TEST_DIR}/.`,
    DyadErrorKind.Precondition,
  );
}

/**
 * Generate the spec file for a recorded draft. `bodyStatements` is the final
 * body — the draft's recorded statements with any approved assertions already
 * interleaved — so this function is pure plumbing: resolve a name, write, stage.
 */
async function writeRecordedSpec({
  appId,
  draft,
  bodyStatements,
}: {
  appId: number;
  draft: RecordedTestDraft;
  bodyStatements: string[];
}): Promise<{ specPath: string }> {
  const appPath = await getAppPath(appId);
  await ensureSignInFixture(appPath, draft);

  const { relativePath, absolutePath } = await resolveSpecPath(
    appPath,
    draft.testName,
  );
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(
    absolutePath,
    generateSpecSource({
      testName: draft.testName,
      includeSignIn: draftIncludesSignIn(draft),
      bodyStatements,
    }),
    "utf-8",
  );
  await stage(appPath, relativePath);

  // The recording has produced its file; a stale draft would otherwise let a
  // later agent turn propose assertions for a test that's already written.
  clearRecordedTestDraft(appId);
  return { specPath: relativePath };
}

/**
 * One-off structured model call. Mirrors the MCP consent classifier's mechanics
 * (abort + timeout raced against the text promise, JSON sliced out of whatever
 * prose the model wrapped it in) with the compaction handler's routing, so the
 * user's selected model is used — which is also what makes E2E hit the fake
 * LLM server.
 */
async function callStructuredModel<T>({
  appId,
  system,
  payload,
  schema,
}: {
  appId: number;
  system: string;
  payload: string;
  schema: z.ZodType<T>;
}): Promise<T> {
  const settings = readSettings();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("assertion model call timed out"));
    }, LLM_TIMEOUT_MS);
  });

  try {
    const { modelClient } = await getModelClient(
      settings.selectedModel,
      settings,
    );
    const dyadRequestId = crypto.randomUUID();

    const stream = streamText({
      output: fastTextOutput(),
      model: modelClient.model,
      system,
      maxRetries: 1,
      abortSignal: controller.signal,
      headers: getAiHeaders({
        builtinProviderId: modelClient.builtinProviderId,
      }),
      providerOptions: getProviderOptions({
        dyadAppId: appId,
        dyadRequestId,
        dyadDisableFiles: true,
        files: [],
        mentionedAppsCodebases: [],
        builtinProviderId: modelClient.builtinProviderId,
        settings,
      }),
      messages: [{ role: "user", content: payload }],
    });

    // If the timeout wins the race, stream.text is orphaned and may reject once
    // the abort propagates. Swallow it so it can't surface as an unhandled
    // rejection.
    const textPromise = Promise.resolve(stream.text);
    textPromise.catch(() => {});
    const text = await Promise.race([textPromise, timeout]);

    const json = extractJson(text);
    if (!json) {
      throw new Error("model returned no parseable JSON");
    }
    return schema.parse(JSON.parse(json));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Synthesize Playwright code for the assertions the user edited or authored.
 *
 * Best-effort by design: a failure here drops only the affected assertions (with
 * a warning) rather than failing the whole approval, so the model-authored
 * assertions the user already reviewed still land — and the test file is still
 * generated.
 */
async function synthesizeAssertionCode({
  appId,
  testTitle,
  bodyStatements,
  items,
}: {
  appId: number;
  testTitle: string;
  bodyStatements: string[];
  items: AssertionPlanItem[];
}): Promise<{ codeById: Map<string, string>; warning?: string }> {
  const pending = items.filter(
    (item) => isAssertionItem(item) && (item.needsCode || !item.code),
  ) as Extract<AssertionPlanItem, { kind: "assertion" }>[];
  if (pending.length === 0) return { codeById: new Map() };

  // "after step N" gives the model the local context an assertion belongs to.
  let stepIndex = -1;
  const afterStepById = new Map<string, number>();
  for (const item of items) {
    if (item.kind === "step") stepIndex = item.stepIndex;
    else afterStepById.set(item.id, stepIndex);
  }

  let raw: z.infer<typeof rawCodeSchema>;
  try {
    raw = await callStructuredModel({
      appId,
      system: TEST_ASSERTION_CODE_SYSTEM_PROMPT,
      payload: buildAssertionCodePayload({
        testTitle,
        bodyStatements,
        requests: pending.map((item) => ({
          id: item.id,
          afterStep: afterStepById.get(item.id) ?? -1,
          text: item.text,
        })),
      }),
      schema: rawCodeSchema,
    });
  } catch (error) {
    logger.warn(`Assertion code synthesis failed for "${testTitle}":`, error);
    return {
      codeById: new Map(),
      warning: `Couldn't generate code for ${pending.length} edited assertion${
        pending.length === 1 ? "" : "s"
      }; ${pending.length === 1 ? "it was" : "they were"} skipped.`,
    };
  }

  const pendingIds = new Set(pending.map((item) => item.id));
  const codeById = new Map<string, string>();
  for (const entry of raw.assertions) {
    if (!pendingIds.has(entry.id)) continue;
    const code = entry.code.trim();
    // A multi-statement or unbalanced line would produce a broken spec.
    if (!isSingleAssertionStatement(code)) {
      logger.warn(`Rejected unusable assertion code for ${entry.id}: ${code}`);
      continue;
    }
    codeById.set(entry.id, code);
  }

  const missing = pending.length - codeById.size;
  return {
    codeById,
    warning:
      missing > 0
        ? `${missing} edited assertion${missing === 1 ? "" : "s"} couldn't be turned into working code and ${
            missing === 1 ? "was" : "were"
          } skipped.`
        : undefined,
  };
}

/**
 * Guard against a renderer that lost, duplicated, or invented a step: the
 * recorded interactions must survive the round-trip exactly, or the plan is
 * describing a different recording than the one we're about to write.
 */
function assertStepsMatch(
  submitted: AssertionPlanItem[],
  stored: AssertionPlanItem[],
): void {
  const indices = (items: AssertionPlanItem[]) =>
    items
      .filter((item) => item.kind === "step")
      .map((item) => (item as { stepIndex: number }).stepIndex)
      .sort((a, b) => a - b)
      .join(",");
  if (indices(submitted) !== indices(stored)) {
    throw new DyadError(
      "The approved plan doesn't match the recorded steps.",
      DyadErrorKind.Validation,
    );
  }
}

async function assertChatOwnsApp(chatId: number, appId: number): Promise<void> {
  const chat = await db.query.chats.findFirst({ where: eq(chats.id, chatId) });
  if (!chat) {
    throw new DyadError(`Chat ${chatId} not found`, DyadErrorKind.NotFound);
  }
  if (chat.appId !== appId) {
    throw new DyadError(
      `Chat ${chatId} does not belong to app ${appId}`,
      DyadErrorKind.Validation,
    );
  }
}

export function registerTestAssertionHandlers() {
  createTypedHandler(
    testsContracts.createRecordedSpec,
    async (_event, params): Promise<CreateRecordedSpecResult> => {
      const { appId, draft } = params;
      const { specPath } = await writeRecordedSpec({
        appId,
        draft,
        bodyStatements: recordedBodyStatements(draft),
      });
      logger.info(`Wrote recorded spec ${specPath} with no assertions`);
      return { specPath };
    },
  );

  createTypedHandler(
    testsContracts.applyTestAssertions,
    async (_event, params): Promise<ApplyTestAssertionsResult> => {
      const { appId, chatId, proposalId, items } = params;

      await assertChatOwnsApp(chatId, appId);

      const chatMessages = await db.query.messages.findMany({
        where: eq(messages.chatId, chatId),
      });
      const row = chatMessages.find(
        (message) =>
          message.content.includes(`<${ASSERTIONS_TAG}`) &&
          readAssertionsTagAttribute(message.content, "proposal-id") ===
            proposalId,
      );
      if (!row) {
        throw new DyadError(
          "This assertion proposal no longer exists.",
          DyadErrorKind.NotFound,
        );
      }

      const stored = parseAssertionsPayloadFromMessage(row.content);
      if (!stored) {
        throw new DyadError(
          "This assertion proposal is corrupted and can't be applied.",
          DyadErrorKind.Validation,
        );
      }
      if (stored.appId !== appId) {
        throw new DyadError(
          "This assertion proposal belongs to a different app.",
          DyadErrorKind.Validation,
        );
      }

      // Idempotent: a second approve (double click, stale card) must not write
      // a second spec file.
      if (readAssertionsTagAttribute(row.content, "status") === "approved") {
        return {
          specPath: stored.specPath ?? "",
          appliedCount: countAssertions(stored.items),
          warning: "This test was already generated.",
        };
      }

      assertStepsMatch(items, stored.items);

      const bodyStatements = recordedBodyStatements(stored.draft);
      const withText = items.filter(
        (item) => item.kind === "step" || item.text.trim().length > 0,
      );
      const { codeById, warning: synthesisWarning } =
        await synthesizeAssertionCode({
          appId,
          testTitle: stored.testTitle,
          bodyStatements,
          items: withText,
        });

      const finalItems: AssertionPlanItem[] = [];
      const finalStatements: string[] = [];
      for (const item of withText) {
        if (item.kind === "step") {
          finalItems.push(item);
          finalStatements.push(bodyStatements[item.stepIndex]);
          continue;
        }
        const code =
          item.needsCode || !item.code ? codeById.get(item.id) : item.code;
        if (!code) continue; // synthesis failed or was rejected; already warned
        finalItems.push({ ...item, code, needsCode: false });
        finalStatements.push(code);
      }

      const { specPath } = await writeRecordedSpec({
        appId,
        draft: stored.draft,
        bodyStatements: finalStatements,
      });

      // Rewriting the tag is the durable approval latch: it survives a reload
      // and re-hydrates the card in its approved state, now pointing at the
      // spec it generated. Splice it in place — the tool emitted the card
      // inside the agent's assistant message, so the surrounding prose and any
      // sibling tool cards must survive untouched.
      const approvedContent = replaceAssertionsTagInMessage(
        row.content,
        buildAssertionsTagContent({
          proposalId,
          status: "approved",
          payload: { ...stored, items: finalItems, specPath },
        }),
      );
      if (approvedContent === null) {
        // The message matched on proposal-id above, so the tag must be there.
        throw new DyadError(
          "This assertion proposal is corrupted and can't be applied.",
          DyadErrorKind.Validation,
        );
      }
      await db
        .update(messages)
        .set({ content: approvedContent })
        .where(eq(messages.id, row.id));

      const appliedCount = countAssertions(finalItems);
      logger.info(
        `Generated ${specPath} with ${appliedCount} assertion(s) (chat ${chatId})`,
      );
      return { specPath, appliedCount, warning: synthesisWarning };
    },
  );
}
