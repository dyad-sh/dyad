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
import { withLock } from "../utils/lock_utils";
import { safeSend } from "../utils/safe_sender";
import { gitAdd, gitResetFile } from "../utils/git_utils";
import { extractJson } from "../utils/extract_json";
import { getModelClient } from "../utils/get_model_client";
import { fastTextOutput } from "../utils/stream_text_utils";
import { getAiHeaders, getProviderOptions } from "../utils/provider_options";
import {
  clearRecordedTestDraft,
  getRecordedTestDraft,
} from "../services/recorded_test_drafts";
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
import {
  generateTestUserFixtureSource,
  readFixtureMode,
} from "@/lib/test_recorder/fixture_templates";
import { isSingleAssertionStatement } from "@/lib/test_recorder/assertion_code";
import {
  buildAssertionsTagContent,
  messageHasAssertionsProposal,
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

/**
 * A user-written fixture that provides the `signIn` the generated spec imports.
 * All three declaration forms count — `export function`, `export const/let/var`
 * (including the arrow-function style most people write), and a re-export list —
 * because the only thing that matters here is whether `import { signIn }` from
 * this module resolves.
 */
const EXPORTS_SIGN_IN_RE =
  /export\s+(async\s+)?function\s+signIn\b|export\s+(const|let|var)\s+signIn\b|export\s*{[^}]*\bsignIn\b/;

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
 * Write the `signIn` helper the generated spec imports.
 *
 * An existing file is never blindly reused: the spec that's about to be written
 * imports `signIn` from here, so a fixture built for the other auth backend — or
 * a user's own unrelated file that happens to sit at this path — produces a spec
 * that fails to compile or silently records as anonymous, while the save UI
 * reports success. Each case gets its own answer:
 *
 * - ours, same auth mode → reuse it (edits included; the contract still holds)
 * - ours, other auth mode, unedited → rewrite for the mode just recorded
 * - ours, other auth mode, edited → refuse; the user's edits are theirs to move
 * - not ours, exports `signIn` → reuse; the user's helper wins
 * - not ours, no `signIn` → refuse; naming the file the user has to reconcile
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
  const source = generateTestUserFixtureSource(draft.authMode);

  if (await fileExists(absolutePath)) {
    const existing = await fs.promises.readFile(absolutePath, "utf-8");
    const existingMode = readFixtureMode(existing);

    if (existingMode === draft.authMode) return;

    if (existingMode) {
      if (existing !== generateTestUserFixtureSource(existingMode)) {
        throw new DyadError(
          `${relativePath} was generated for ${existingMode} auth and has been edited, but this recording signs in with ${draft.authMode}. Move your changes into a helper of your own (or delete the file) and generate the test again.`,
          DyadErrorKind.Precondition,
        );
      }
      logger.info(
        `Regenerating ${relativePath}: was ${existingMode}, recording used ${draft.authMode}`,
      );
    } else if (EXPORTS_SIGN_IN_RE.test(existing)) {
      // The user's own helper. Same import, same call — leave it alone.
      return;
    } else {
      throw new DyadError(
        `${relativePath} already exists but doesn't export a \`signIn\` helper, and the generated test imports one from there. Rename or remove that file, then generate the test again.`,
        DyadErrorKind.Precondition,
      );
    }
  }

  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(absolutePath, source, "utf-8");
  await stage(appPath, relativePath);
}

/**
 * Claim a free `e2e-tests/recorded-<slug>.spec.ts` and write it. A re-recording,
 * a second flow whose name slugifies the same, or repeated blank-name saves must
 * never clobber a spec that already exists — disambiguate with a numeric suffix.
 *
 * Claiming and writing are one exclusive-create call rather than "check, then
 * write": those are two syscalls, so anything that took the name in between (a
 * concurrent approval, the user's editor) would otherwise be silently
 * overwritten. Losing that race just advances to the next suffix.
 */
async function writeSpecToFreePath(
  appPath: string,
  testName: string,
  source: string,
): Promise<{ relativePath: string }> {
  for (let index = 1; index <= MAX_SPEC_NAME_ATTEMPTS; index++) {
    const candidate = `${E2E_TEST_DIR}/${recordedSpecFileName(testName, index)}`;
    // Re-validated per candidate: the name is derived from user input, and this
    // is the only thing standing between it and a write outside the app.
    const relativePath = await assertMutationPathAllowed({
      appPath,
      relativePath: candidate,
    });
    const absolutePath = path.join(appPath, relativePath);
    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    try {
      await fs.promises.writeFile(absolutePath, source, {
        encoding: "utf-8",
        flag: "wx",
      });
      return { relativePath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
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

  const { relativePath } = await writeSpecToFreePath(
    appPath,
    draft.testName,
    generateSpecSource({
      testName: draft.testName,
      includeSignIn: draftIncludesSignIn(draft),
      bodyStatements,
    }),
  );
  await stage(appPath, relativePath);

  // The recording has produced its file; a stale draft would otherwise let a
  // later agent turn propose assertions for a test that's already written.
  clearRecordedTestDraft(appId);
  return { specPath: relativePath };
}

/**
 * Roll back a spec this approval just wrote, because the approval itself
 * couldn't be recorded. Best-effort: leaving the file behind is a duplicate
 * test, not data loss, so a failure here is logged rather than raised over the
 * error that triggered the rollback.
 */
async function discardGeneratedSpec(
  appId: number,
  specPath: string,
): Promise<void> {
  try {
    const appPath = await getAppPath(appId);
    await fs.promises.rm(path.join(appPath, specPath), { force: true });
    // The write staged the file; leaving that entry behind would show the
    // uncommitted-changes review a spec that no longer exists.
    try {
      await gitResetFile({ path: appPath, filepath: specPath });
    } catch (error) {
      logger.warn(`Removed ${specPath} but couldn't unstage it:`, error);
    }
    logger.warn(`Rolled back ${specPath}: the approval couldn't be persisted`);
  } catch (error) {
    logger.error(
      `Couldn't roll back ${specPath} after a failed approval:`,
      error,
    );
  }
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
  pending,
}: {
  appId: number;
  testTitle: string;
  bodyStatements: string[];
  items: AssertionPlanItem[];
  /** The assertions whose code must come from the model, decided by the caller. */
  pending: Extract<AssertionPlanItem, { kind: "assertion" }>[];
}): Promise<{ codeById: Map<string, string>; warning?: string }> {
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
 * Guard against a renderer that lost, duplicated, invented, or reordered a step:
 * the recorded interactions must survive the round-trip exactly, or the plan is
 * describing a different recording than the one we're about to write.
 *
 * Compared in encounter order, not sorted — the write loop below emits steps in
 * the submitted order, so a resequenced `[1, 0]` would otherwise validate
 * against `[0, 1]` and generate a test that replays the recording backwards.
 * Assertions are free to move; steps are not.
 */
function assertStepsMatch(
  submitted: AssertionPlanItem[],
  stored: AssertionPlanItem[],
): void {
  const indices = (items: AssertionPlanItem[]) =>
    items
      .filter((item) => item.kind === "step")
      .map((item) => (item as { stepIndex: number }).stepIndex)
      .join(",");
  if (indices(submitted) !== indices(stored)) {
    throw new DyadError(
      "The approved plan doesn't match the recorded steps.",
      DyadErrorKind.Validation,
    );
  }
}

/**
 * Decide, per assertion, which code may be written — never trusting the
 * renderer's `code`/`needsCode` pair on its own.
 *
 * An assertion whose text is unchanged from the stored proposal keeps the code
 * that proposal already validated. Anything else (edited text, user-authored,
 * an id we've never seen) is synthesized here from the text and re-validated.
 * Without this, a renderer could set `needsCode: false` alongside arbitrary
 * TypeScript and have it written verbatim into a spec that later runs with
 * Node's privileges.
 */
function resolveAssertionCode({
  item,
  stored,
  synthesized,
}: {
  item: Extract<AssertionPlanItem, { kind: "assertion" }>;
  stored: Map<string, Extract<AssertionPlanItem, { kind: "assertion" }>>;
  synthesized: Map<string, string>;
}): string | undefined {
  const fresh = synthesized.get(item.id);
  if (fresh) return fresh;
  const original = stored.get(item.id);
  if (!original?.code) return undefined;
  // The stored text is what the user reviewed the stored code against.
  if (original.text.trim() !== item.text.trim()) return undefined;
  return isSingleAssertionStatement(original.code) ? original.code : undefined;
}

/**
 * Which assertions need code synthesized: everything the renderer flagged, plus
 * everything we can't safely reuse from the stored proposal. Computed here (not
 * taken from `needsCode`) so the trust decision lives in one place.
 */
function needsSynthesis(
  item: Extract<AssertionPlanItem, { kind: "assertion" }>,
  stored: Map<string, Extract<AssertionPlanItem, { kind: "assertion" }>>,
): boolean {
  if (item.needsCode) return true;
  const original = stored.get(item.id);
  if (!original?.code || !isSingleAssertionStatement(original.code))
    return true;
  return original.text.trim() !== item.text.trim();
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
      // The parked draft is what says "this recording hasn't been written yet".
      // Both write paths clear it, so its absence means the spec already exists
      // and a second call — a stale recording bar, a double click — would write
      // a suffixed duplicate of the same test.
      if (!getRecordedTestDraft(appId)) {
        throw new DyadError(
          "This recording has already been saved.",
          DyadErrorKind.Precondition,
        );
      }
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
    // The approval reads the proposal's status, spends up to a minute in the
    // model, then writes "approved" back. Serializing per proposal is what makes
    // that read-modify-write an actual latch: a double click or a second window
    // would otherwise both pass the status check and generate two spec files.
    // The loser re-reads the now-approved tag and returns the idempotent answer.
    async (event, params): Promise<ApplyTestAssertionsResult> =>
      withLock(`assertion-approval:${params.proposalId}`, async () => {
        const { appId, chatId, proposalId, items } = params;

        await assertChatOwnsApp(chatId, appId);

        const chatMessages = await db.query.messages.findMany({
          where: eq(messages.chatId, chatId),
        });
        // Scoped to this proposal throughout: one assistant message can carry
        // more than one card, and matching only the first would make approving
        // the second read — and then overwrite — the wrong one.
        const row = chatMessages.find((message) =>
          messageHasAssertionsProposal(message.content, proposalId),
        );
        if (!row) {
          throw new DyadError(
            "This assertion proposal no longer exists.",
            DyadErrorKind.NotFound,
          );
        }

        const stored = parseAssertionsPayloadFromMessage(
          row.content,
          proposalId,
        );
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
        if (
          readAssertionsTagAttribute(row.content, "status", proposalId) ===
          "approved"
        ) {
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
        // The proposal in the chat message is the trusted record of what the model
        // wrote and the user reviewed. The renderer may reorder, drop, and edit
        // plan items, but the code that lands in the spec is only ever the
        // proposal's own validated code or something synthesized here.
        const storedAssertions = new Map(
          stored.items
            .filter(isAssertionItem)
            .map((item) => [item.id, item] as const),
        );
        const pending = withText
          .filter(isAssertionItem)
          .filter((item) => needsSynthesis(item, storedAssertions));
        const { codeById, warning: synthesisWarning } =
          await synthesizeAssertionCode({
            appId,
            testTitle: stored.testTitle,
            bodyStatements,
            items: withText,
            pending,
          });

        const finalItems: AssertionPlanItem[] = [];
        const finalStatements: string[] = [];
        for (const item of withText) {
          if (item.kind === "step") {
            finalItems.push(item);
            finalStatements.push(bodyStatements[item.stepIndex]);
            continue;
          }
          const code = resolveAssertionCode({
            item,
            stored: storedAssertions,
            synthesized: codeById,
          });
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
          proposalId,
        );
        if (approvedContent === null) {
          // The message matched on proposal-id above, so the tag must be there.
          await discardGeneratedSpec(appId, specPath);
          throw new DyadError(
            "This assertion proposal is corrupted and can't be applied.",
            DyadErrorKind.Validation,
          );
        }
        try {
          await db
            .update(messages)
            .set({ content: approvedContent })
            .where(eq(messages.id, row.id));
        } catch (error) {
          // The spec exists but the proposal is still "proposed", so the card
          // stays approvable — and a retry would claim the *next* free filename
          // and leave two copies of the same test behind. Undo the write so the
          // retry produces exactly one spec.
          await discardGeneratedSpec(appId, specPath);
          throw error;
        }

        // The recording bar is still up in the preview, holding the draft this
        // just turned into a file. Nothing else tells it — approval happens
        // entirely in the chat — so without this it keeps offering "Save without
        // assertions" for a test that already exists, which writes a second,
        // suffixed copy of it.
        safeSend(event.sender, "recording:draft-consumed", { appId, specPath });

        const appliedCount = countAssertions(finalItems);
        logger.info(
          `Generated ${specPath} with ${appliedCount} assertion(s) (chat ${chatId})`,
        );
        return { specPath, appliedCount, warning: synthesisWarning };
      }),
  );
}
