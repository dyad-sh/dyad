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
import type { ApplyTestAssertionsResult } from "../types/tests";
import { assertMutationPathAllowed } from "../utils/path_utils";
import { withLock } from "../utils/lock_utils";
import { broadcastToAllWindows } from "../utils/window_broadcast";
import {
  gitAdd,
  gitResetFile,
  readGitIndexEntry,
  restoreGitIndexEntry,
  type GitIndexEntry,
} from "../utils/git_utils";
import { extractJson } from "../utils/extract_json";
import { getModelClient } from "../utils/get_model_client";
import { fastTextOutput } from "../utils/stream_text_utils";
import { getAiHeaders, getProviderOptions } from "../utils/provider_options";
import {
  clearRecordedTestDraft,
  forgetRecordedDraftWrite,
  getWrittenSpecForDraft,
  markRecordedDraftWritten,
  restoreRecordedTestDraft,
} from "../services/recorded_test_drafts";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  countAssertions,
  isAssertionItem,
  type AssertionPlanItem,
  type AssertionProposalPayload,
} from "@/lib/test_recorder/assertion_proposal";
import {
  draftIncludesSignIn,
  normalizeTestName,
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
import {
  appOperationCoordinator,
  readAppResource,
} from "../services/app_operation_coordinator";
import { assertNoActiveRecording } from "../services/recording_registry";

/**
 * Writing a recorded test to disk. Approving the assertion card is the only way
 * a recording becomes a file, and it goes through deterministic codegen, so what
 * the user reviewed is what gets written. A model is only ever asked for the
 * text of an assertion and the test's name, never for the file.
 */

const logger = log.scope("test_assertion_handlers");

const LLM_TIMEOUT_MS = 60_000;

const FIXTURE_PATH = `${E2E_TEST_DIR}/fixtures/test-user.ts`;

const RECORDED_DRAFT_MARKER_PREFIX = "// dyad-recording-draft-id: ";

/** How many `recorded-<slug>-N.spec.ts` variants to try before giving up. */
const MAX_SPEC_NAME_ATTEMPTS = 100;

/**
 * Serializes every path that turns a recording into a file for one app.
 *
 * "Has this recording been written yet?" and the write itself have to be one
 * critical section, or two approvals of the same recording — the user asked
 * again and answered both cards — both pass the check and `writeSpecToFreePath`
 * dutifully claims the next free suffix for each.
 */
const specWriteKey = (appId: number) => `recorded-spec:${appId}`;

/**
 * Serializes every rewrite of an assertion card's tag in a chat.
 *
 * Keyed by chat rather than by proposal because both handlers write the whole
 * `messages.content` blob: one agent message can carry more than one card, so
 * two proposals rewriting "their own" tag concurrently would each save a copy
 * of the row read before the other's write, and one of the two updates would be
 * lost. Approvals are rare enough that a chat-wide latch costs nothing.
 */
const proposalWriteKey = (chatId: number) => `assertion-proposal:${chatId}`;

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

function recordedDraftMarker(draft: RecordedTestDraft): string {
  // JSON encoding keeps even an unexpected newline or comment delimiter inside
  // the comment. Draft ids are normally UUIDs, but this is a persistence marker
  // in a user-owned source file, so do not rely on that upstream assumption.
  return `${RECORDED_DRAFT_MARKER_PREFIX}${JSON.stringify(draft.draftId)}`;
}

/**
 * The marker line written into the spec: the draft it came from, plus the
 * proposal whose plan produced it.
 *
 * The proposal id is what makes a re-approval able to recognise its OWN file.
 * Writing the spec and latching the card are two steps, and a crash between
 * them leaves a file on disk that the card has no record of. Without this the
 * retry can only tell that *something* already wrote this recording, and
 * reports "no assertions were added" over a file that contains them.
 *
 * Appended after the draft marker so every existing reader — which compares the
 * draft marker as a prefix — keeps working on specs written before this, and on
 * specs a user has hand-edited the tail of.
 */
function recordedSpecMarker(
  draft: RecordedTestDraft,
  proposalId: string,
): string {
  return `${recordedDraftMarker(draft)} ${JSON.stringify(proposalId)}`;
}

/**
 * Whether a spec's first line is this draft's marker.
 *
 * A prefix match, so the optional proposal id after the draft id doesn't make
 * an otherwise-matching spec invisible. Bounded on the right by requiring the
 * next character to be a space or nothing at all, so one draft id can never
 * match another that merely starts with it.
 */
function markerLineMatchesDraft(
  line: string | undefined,
  draft: RecordedTestDraft,
): boolean {
  if (line === undefined) return false;
  const marker = recordedDraftMarker(draft);
  if (!line.startsWith(marker)) return false;
  const next = line[marker.length];
  return next === undefined || next === " ";
}

/** The proposal id in a spec's marker line, or null for a spec without one. */
function proposalIdFromMarkerLine(
  line: string,
  draft: RecordedTestDraft,
): string | null {
  const rest = line.slice(recordedDraftMarker(draft).length).trim();
  if (!rest) return null;
  try {
    const parsed: unknown = JSON.parse(rest);
    return typeof parsed === "string" && parsed ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Whether the file at `relativePath` is still this draft's generated spec, and
 * which proposal wrote it.
 *
 * A read that fails for any reason other than "not there" answers yes: we
 * cannot prove the spec is gone, and writing a duplicate on a transient error is
 * worse than trusting a path that may since have moved. `proposalId` is null
 * whenever it can't be read, which is the conservative answer — the caller then
 * treats the file as somebody else's and latches steps only.
 */
async function specCarriesDraftMarker(
  appPath: string,
  relativePath: string,
  draft: RecordedTestDraft,
): Promise<{ matches: boolean; proposalId: string | null }> {
  try {
    const source = await fs.promises.readFile(
      path.join(appPath, relativePath),
      "utf-8",
    );
    // Prefix, not equality: the line now carries the writing proposal's id
    // after the draft id, and specs written before that don't.
    const line = source.split(/\r?\n/, 1)[0];
    if (!markerLineMatchesDraft(line, draft)) {
      return { matches: false, proposalId: null };
    }
    return { matches: true, proposalId: proposalIdFromMarkerLine(line, draft) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { matches: false, proposalId: null };
    }
    logger.warn(
      `Couldn't re-check ${relativePath} for its recorded draft marker; keeping it:`,
      error,
    );
    return { matches: true, proposalId: null };
  }
}

/** A generated spec already on disk for this recording. */
interface WrittenSpec {
  relativePath: string;
  /**
   * The proposal whose plan produced the file, when its marker records one.
   *
   * Null for a spec written before the marker carried it, or one whose marker
   * couldn't be read. Both mean "assume another card wrote this", which is the
   * conservative answer: it under-claims what the file contains rather than
   * latching checks that may not be in it.
   */
  proposalId: string | null;
}

/**
 * Find the durable marker written into a generated spec. The in-memory map is
 * still the hot path; this scan is the restart/eviction fallback that keeps a
 * second persisted assertion card from writing a suffixed twin.
 */
async function findWrittenSpecForDraft(
  appId: number,
  appPath: string,
  draft: RecordedTestDraft,
): Promise<WrittenSpec | null> {
  const remembered = getWrittenSpecForDraft(appId, draft);
  // Re-checked rather than trusted: the Tests panel can delete or rename a
  // generated spec while another card for the same recording is still open, and
  // answering "already saved" with that path leaves the card's Open button
  // pointing at a file that isn't there. A stale entry is dropped so the scan
  // below — and, finding nothing, the write — can proceed as if it never
  // existed.
  if (remembered) {
    const marker = await specCarriesDraftMarker(appPath, remembered, draft);
    if (marker.matches) {
      return { relativePath: remembered, proposalId: marker.proposalId };
    }
    logger.info(
      `Forgetting ${remembered}: it no longer carries this recording's marker`,
    );
    forgetRecordedDraftWrite(appId, draft);
  }

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(path.join(appPath, E2E_TEST_DIR), {
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    // Generated specs are flat in e2e-tests/. Skipping symlinks also prevents
    // this duplicate guard from following a user-created link outside the app.
    if (!entry.isFile() || !/^recorded-.+\.spec\.ts$/.test(entry.name)) {
      continue;
    }
    let source: string;
    try {
      source = await fs.promises.readFile(
        path.join(appPath, E2E_TEST_DIR, entry.name),
        "utf-8",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // The file disappeared after readdir. It cannot contain the marker now,
        // so continue just as if it had not appeared in the listing.
        continue;
      }
      // An existing candidate that cannot be inspected may be this draft's
      // durable record. Surface the read failure rather than silently writing a
      // suffixed duplicate and consuming the draft a second time.
      logger.warn(
        `Couldn't inspect ${entry.name} for a recorded draft marker:`,
        error,
      );
      throw error;
    }
    const line = source.split(/\r?\n/, 1)[0];
    if (!markerLineMatchesDraft(line, draft)) continue;

    const relativePath = `${E2E_TEST_DIR}/${entry.name}`;
    markRecordedDraftWritten(appId, draft, relativePath);
    return {
      relativePath,
      proposalId: proposalIdFromMarkerLine(line, draft),
    };
  }
  return null;
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
 * Write the `signIn` helper the generated spec imports, if nothing is there yet.
 *
 * An existing file is left exactly as it is — it may be the user's own helper,
 * or ours with their edits in it, and neither is ours to judge from here. The one
 * exception is a fixture we wrote for the *other* auth backend and nobody has
 * touched since (byte-identical to what we generate for that mode): reusing it
 * guarantees a failing sign-in, and rewriting it discards nothing.
 *
 * Deliberately never throws. Whether a given file really provides `signIn` can't
 * be decided by reading it here, and guessing wrong blocks the user behind an
 * error toast; a fixture that doesn't work fails when the test runs, which is
 * where the agent already fixes it.
 *
 * Returns what it changed, or null when it left the tree alone, so a failed
 * approval can put the fixture back. An approval that rolls its spec back but
 * keeps a created or backend-swapped `test-user.ts` staged leaves the user a
 * change they never approved, for a test that doesn't exist.
 */
interface SignInFixtureChange {
  relativePath: string;
  absolutePath: string;
  /** The bytes that were there before, or null when we created the file. */
  previousContent: string | null;
  /**
   * The index entry as it stood before we staged over it, or null when the path
   * wasn't staged.
   *
   * Restoring the working-tree bytes and re-adding them is NOT the same thing:
   * that rebuilds the index from content and discards whatever the user had
   * staged for this path — a staged delete most of all, which has no content to
   * rebuild from. `undefined` means the snapshot itself failed, so rollback
   * falls back to the content-based restore rather than guessing.
   */
  previousIndexEntry: GitIndexEntry | null | undefined;
}

async function ensureSignInFixture(
  appPath: string,
  draft: RecordedTestDraft,
): Promise<SignInFixtureChange | null> {
  if (draft.authMode === "none") return null;
  const relativePath = await assertMutationPathAllowed({
    appPath,
    relativePath: FIXTURE_PATH,
  });
  const absolutePath = path.join(appPath, relativePath);

  let previousContent: string | null = null;
  if (await fileExists(absolutePath)) {
    const existing = await fs.promises.readFile(absolutePath, "utf-8");
    const existingMode = readFixtureMode(existing);
    const isStaleOurs =
      existingMode !== null &&
      existingMode !== draft.authMode &&
      existing === generateTestUserFixtureSource(existingMode);
    if (!isStaleOurs) return null;
    previousContent = existing;
    logger.info(
      `Regenerating ${relativePath}: was ${existingMode}, recording used ${draft.authMode}`,
    );
  }

  // Snapshotted before the write, so a rollback can put the user's staged state
  // back byte for byte instead of inferring it from the file we restore.
  let previousIndexEntry: GitIndexEntry | null | undefined;
  try {
    previousIndexEntry = await readGitIndexEntry({
      path: appPath,
      filepath: relativePath,
    });
  } catch (error) {
    logger.warn(
      `Couldn't snapshot the index entry for ${relativePath}; a rollback will restore its contents only:`,
      error,
    );
  }

  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(
    absolutePath,
    generateTestUserFixtureSource(draft.authMode),
    "utf-8",
  );
  await stage(appPath, relativePath);
  return { relativePath, absolutePath, previousContent, previousIndexEntry };
}

/**
 * Undo an `ensureSignInFixture` write, for an approval that has been rolled
 * back. Best-effort and never throws, for the same reason `discardGeneratedSpec`
 * isn't fatal: this runs while a real error is already on its way to the user.
 */
async function revertSignInFixture(
  appPath: string,
  change: SignInFixtureChange,
): Promise<void> {
  try {
    if (change.previousContent === null) {
      // We created it, so the tree had no such file.
      await fs.promises.rm(change.absolutePath, { force: true });
    } else {
      // We replaced our own stale fixture. Put the exact bytes back.
      await fs.promises.writeFile(
        change.absolutePath,
        change.previousContent,
        "utf-8",
      );
    }

    // The index is restored from the snapshot, not rebuilt from the file we
    // just put back: the user may have had something else staged for this path,
    // and re-adding the working-tree bytes (or resetting to HEAD) would replace
    // it with content they never staged. Only when the snapshot failed do we
    // fall back to the content-based restore.
    if (change.previousIndexEntry !== undefined) {
      try {
        await restoreGitIndexEntry({
          path: appPath,
          filepath: change.relativePath,
          entry: change.previousIndexEntry,
        });
        return;
      } catch (error) {
        logger.warn(
          `Restored ${change.relativePath} but couldn't put its index entry back:`,
          error,
        );
        return;
      }
    }

    if (change.previousContent === null) {
      // Unstage, or the uncommitted-changes review lists a file that is no
      // longer there.
      try {
        await gitResetFile({ path: appPath, filepath: change.relativePath });
      } catch (error) {
        logger.warn(
          `Removed ${change.relativePath} but couldn't unstage it:`,
          error,
        );
      }
      return;
    }
    await stage(appPath, change.relativePath);
  } catch (error) {
    logger.error(
      `Couldn't restore ${change.relativePath} after a failed approval:`,
      error,
    );
  }
}

/**
 * Claim a free `e2e-tests/recorded-<slug>.spec.ts` and write it, disambiguating
 * with a numeric suffix so a re-recording never clobbers an existing spec.
 *
 * One exclusive-create call rather than "check, then write": those are two
 * syscalls, so anything that took the name in between would be silently
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
 * Generate the spec file for a recorded draft. `bodyStatements` is the final body
 * (recorded statements with approved assertions already interleaved), so this is
 * pure plumbing: resolve a name, write, stage.
 */
async function writeRecordedSpec({
  appId,
  appPath,
  draft,
  proposalId,
  bodyStatements,
}: {
  appId: number;
  appPath: string;
  draft: RecordedTestDraft;
  /** Stamped into the marker so a re-approval can recognise its own write. */
  proposalId: string;
  bodyStatements: string[];
}): Promise<{ specPath: string; fixtureChange: SignInFixtureChange | null }> {
  const fixtureChange = await ensureSignInFixture(appPath, draft);

  // The name comes from the user or, far more often, from the model that
  // proposed this test — both by way of the renderer, so a last-resort default
  // rather than an assumption that one arrived.
  const testName = normalizeTestName(draft.testName) || "recorded test";
  const generatedSource = generateSpecSource({
    testName,
    includeSignIn: draftIncludesSignIn(draft),
    bodyStatements,
  });
  let relativePath: string;
  try {
    ({ relativePath } = await writeSpecToFreePath(
      appPath,
      testName,
      `${recordedSpecMarker(draft, proposalId)}\n${generatedSource}`,
    ));
  } catch (error) {
    // The spec never landed, so the fixture written for it is a change the user
    // never asked for. Undone here rather than by the caller, which has no
    // successful write to roll back and so never learns one happened.
    if (fixtureChange) await revertSignInFixture(appPath, fixtureChange);
    throw error;
  }
  await stage(appPath, relativePath);

  // The recording has produced its file. Remembered because a recording can
  // have more than one card — "Ask again" proposes the same draft afresh — and
  // each card generates from its own copy, so nothing else connects them: the
  // second approval returns the idempotent answer instead of a suffixed twin.
  markRecordedDraftWritten(appId, draft, relativePath);
  // A stale draft would otherwise let a later agent turn propose assertions for
  // a test that's already written. Scoped to this recording: a card approved
  // after a newer recording was parked must not discard that newer draft.
  clearRecordedTestDraft(appId, draft.draftId);
  return { specPath: relativePath, fixtureChange };
}

/**
 * Roll back a spec this approval just wrote, because the approval itself couldn't
 * be recorded. Best-effort: leaving the file behind is a duplicate test, not data
 * loss, so a failure here is logged rather than raised over the original error.
 *
 * `fixtureChange` is the `test-user.ts` write the same approval made, if any. It
 * goes back with the spec: on its own it is a staged auth fixture the user never
 * asked for, supporting an import in a file that no longer exists.
 */
async function discardGeneratedSpec(
  appId: number,
  specPath: string,
  fixtureChange: SignInFixtureChange | null,
): Promise<void> {
  try {
    await appOperationCoordinator.run(
      {
        appId,
        operation: "rollback-recorded-test",
        resources: [readAppResource("app-path"), "repository", "test-files"],
      },
      async () => {
        const appPath = await getAppPath(appId);
        await fs.promises.rm(path.join(appPath, specPath), { force: true });
        // The write staged the file; leaving that entry behind would show the
        // uncommitted-changes review a spec that no longer exists.
        try {
          await gitResetFile({ path: appPath, filepath: specPath });
        } catch (error) {
          logger.warn(`Removed ${specPath} but couldn't unstage it:`, error);
        }
        if (fixtureChange) {
          await revertSignInFixture(appPath, fixtureChange);
        }
        logger.warn(
          `Rolled back ${specPath}: the approval couldn't be persisted`,
        );
      },
    );
  } catch (error) {
    logger.error(
      `Couldn't roll back ${specPath} after a failed approval:`,
      error,
    );
  }
}

/**
 * One-off structured model call. Mirrors the MCP consent classifier's mechanics
 * with the compaction handler's routing, so the user's selected model is used —
 * which is also what makes E2E hit the fake LLM server.
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
  // Observed from the moment it exists. The timer starts before the client is
  // resolved below, so there is a window in which nothing is racing this
  // promise; a rejection landing there would surface as an unhandled rejection
  // rather than as this call timing out.
  timeout.catch(() => {});

  try {
    // Raced too, not just awaited: the timer is meant to bound the whole
    // operation, and `getModelClient` can reach the provider registry. Without
    // this the budget only ever covered the streaming half, and a slow client
    // resolution aborted a stream that did not exist yet.
    const { modelClient } = await Promise.race([
      getModelClient(settings.selectedModel, settings),
      timeout,
    ]);
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

    // If the timeout wins, stream.text is orphaned and may reject once the abort
    // propagates. Swallow it so it can't become an unhandled rejection.
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
 * Best-effort: a failure drops only the affected assertions (with a warning)
 * rather than failing the whole approval.
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
 * Guard against a renderer that lost, duplicated, invented, or reordered a step.
 * Compared in encounter order, not sorted: the write loop emits steps in the
 * submitted order, so a resequenced `[1, 0]` would otherwise validate against
 * `[0, 1]` and replay the recording backwards. Assertions may move; steps
 * may not.
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
 * renderer's `code`/`needsCode` pair. Unchanged text keeps the code the stored
 * proposal already validated; anything else is synthesized here and re-validated.
 * Without this a renderer could set `needsCode: false` alongside arbitrary
 * TypeScript and have it written verbatim into a spec that runs with Node's
 * privileges.
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
 * Everything the renderer flagged, plus everything we can't safely reuse from the
 * stored proposal. Computed here so the trust decision lives in one place.
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

/**
 * Rewrite the proposal's tag to "approved" and persist it. This is the durable
 * approval latch: it survives a reload and re-hydrates the card approved. The tag
 * is spliced in place so the agent's surrounding prose and sibling tool cards
 * survive untouched.
 */
async function persistApproval({
  row,
  proposalId,
  stored,
  items,
  specPath,
}: {
  row: { id: number; content: string };
  proposalId: string;
  stored: AssertionProposalPayload;
  items: AssertionPlanItem[];
  specPath: string;
}): Promise<void> {
  const approvedContent = replaceAssertionsTagInMessage(
    row.content,
    buildAssertionsTagContent({
      proposalId,
      status: "approved",
      payload: { ...stored, items, specPath },
    }),
    proposalId,
  );
  if (approvedContent === null) {
    // The message matched on proposal-id, so the tag must be there.
    throw new DyadError(
      "This assertion proposal is corrupted and can't be applied.",
      DyadErrorKind.Validation,
    );
  }
  await db
    .update(messages)
    .set({ content: approvedContent })
    .where(eq(messages.id, row.id));
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
    testsContracts.discardTestAssertions,
    // The same critical section approval uses. Both are read-modify-writes of
    // one message row, so without a shared lock a discard that read the row
    // before an approval started would write its stale copy over the approved
    // one — and latch a spec that exists on disk as declined.
    async (_event, params) =>
      withLock(proposalWriteKey(params.chatId), async () => {
        const { appId, chatId, proposalId } = params;
        await assertChatOwnsApp(chatId, appId);

        const chatMessages = await db.query.messages.findMany({
          where: eq(messages.chatId, chatId),
        });
        const row = chatMessages.find((message) =>
          messageHasAssertionsProposal(message.content, proposalId),
        );
        if (!row) {
          throw new DyadError(
            "This assertion proposal no longer exists.",
            DyadErrorKind.NotFound,
          );
        }
        const status = readAssertionsTagAttribute(
          row.content,
          "status",
          proposalId,
        );
        // Approving already wrote a file; declining afterwards would claim
        // nothing happened. Idempotent for a repeated discard.
        if (status === "approved" || status === "discarded") {
          return { ok: true as const };
        }

        const stored = parseAssertionsPayloadFromMessage(
          row.content,
          proposalId,
        );
        if (!stored) {
          throw new DyadError(
            "This assertion proposal is corrupted and can't be discarded.",
            DyadErrorKind.Validation,
          );
        }
        if (stored.appId !== appId) {
          throw new DyadError(
            "This assertion proposal belongs to a different app.",
            DyadErrorKind.Validation,
          );
        }

        const discardedContent = replaceAssertionsTagInMessage(
          row.content,
          buildAssertionsTagContent({
            proposalId,
            status: "discarded",
            payload: stored,
          }),
          proposalId,
        );
        if (discardedContent === null) {
          throw new DyadError(
            "This assertion proposal is corrupted and can't be discarded.",
            DyadErrorKind.Validation,
          );
        }
        await db
          .update(messages)
          .set({ content: discardedContent })
          .where(eq(messages.id, row.id));
        logger.info(
          `Discarded assertion proposal ${proposalId} (chat ${chatId})`,
        );
        return { ok: true as const };
      }),
  );

  createTypedHandler(
    testsContracts.applyTestAssertions,
    // The approval reads the proposal's status, spends up to a minute in the
    // model, then writes "approved" back. Serializing makes that
    // read-modify-write an actual latch; the loser re-reads the now-approved tag
    // and returns the idempotent answer.
    async (_event, params): Promise<ApplyTestAssertionsResult> =>
      withLock(proposalWriteKey(params.chatId), async () => {
        const { appId, chatId, proposalId, items } = params;

        await assertChatOwnsApp(chatId, appId);

        const chatMessages = await db.query.messages.findMany({
          where: eq(messages.chatId, chatId),
        });
        // Scoped to this proposal throughout: one message can carry more than
        // one card, and matching the first would overwrite the wrong one.
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

        const status = readAssertionsTagAttribute(
          row.content,
          "status",
          proposalId,
        );
        // Idempotent: a second approve (double click, stale card) must not write
        // a second spec file.
        if (status === "approved") {
          return {
            specPath: stored.specPath ?? "",
            appliedCount: countAssertions(stored.items),
            warning: "This test was already generated.",
          };
        }
        // Declining is as final as approving. A stale card left open in another
        // window would otherwise generate the very test the user closed —
        // possible because the discard is durable but the card that wrote it
        // isn't the only copy on screen.
        if (status === "discarded") {
          throw new DyadError(
            "This assertion plan was closed, so it can't be applied. Ask for assertions again to get a fresh one.",
            DyadErrorKind.Precondition,
          );
        }

        assertStepsMatch(items, stored.items);

        // Everything below takes app-path, test-files and repository through the
        // coordinator, and a recording session holds all three as write claims
        // for its whole lifetime — read-vs-write conflicts too, so approving
        // during one queues with no timeout and the card sits on "Generating…"
        // for up to the 30-minute session cap with nothing saying why. Refused
        // here for the same reason duplicate/undo/restore refuse: the recording
        // is what the user is doing, so only they can decide to end it. Checked
        // after the idempotency latches above so a card that was already
        // approved still returns its answer instead of failing.
        assertNoActiveRecording(appId, "generate this test");

        // One recording can have more than one card: "Ask again" proposes the
        // same draft afresh, and each card carries its own copy of it — which is
        // what makes approving survive a restart, and also what leaves nothing
        // else to notice that the recording is already a file.
        const alreadyWritten = await appOperationCoordinator.run(
          {
            appId,
            operation: "find-recorded-test",
            resources: [
              readAppResource("app-path"),
              readAppResource("test-files"),
            ],
          },
          async () => {
            const appPath = await getAppPath(appId);
            return findWrittenSpecForDraft(appId, appPath, stored.draft);
          },
        );
        if (alreadyWritten) {
          // This card's own earlier write, finished but never latched: the
          // process died between `writeRecordedSpec` and `persistApproval`. The
          // file on disk already contains THIS plan's checks, so reporting
          // "no assertions were added" would be describing someone else's file
          // — and would leave the card, and the resumed agent turn, wrong about
          // a test that is exactly what the user approved.
          if (alreadyWritten.proposalId === proposalId) {
            const recovered = stored.items;
            await persistApproval({
              row,
              proposalId,
              stored,
              items: recovered,
              specPath: alreadyWritten.relativePath,
            });
            return {
              specPath: alreadyWritten.relativePath,
              appliedCount: countAssertions(recovered),
            };
          }
          await persistApproval({
            row,
            proposalId,
            stored,
            // Steps only. This card's checks were NOT written — the spec on
            // disk carries whichever plan got there first — so latching them as
            // approved would render a card claiming checks, and showing their
            // code, that the file the button opens does not contain.
            items: stored.items.filter((item) => item.kind === "step"),
            specPath: alreadyWritten.relativePath,
          });
          return {
            specPath: alreadyWritten.relativePath,
            appliedCount: 0,
            warning: `This recording was already saved as ${alreadyWritten.relativePath}, so no assertions were added.`,
          };
        }

        const bodyStatements = recordedBodyStatements(stored.draft);
        const withText = items.filter(
          (item) => item.kind === "step" || item.text.trim().length > 0,
        );
        // The proposal in the chat message is the trusted record. The renderer
        // may reorder, drop, and edit plan items, but the code that lands in the
        // spec is only ever the proposal's validated code or synthesized here.
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

        // Synthesis above spent up to a minute in the model, so re-check under
        // the write lock: another card for this same recording may have been
        // approved while we waited.
        const { specPath, wroteIt, racedProposalId, fixtureChange } =
          await appOperationCoordinator.run(
            {
              appId,
              operation: "write-recorded-test",
              resources: [
                readAppResource("app-path"),
                "repository",
                "test-files",
              ],
              // The preflight above has to run after the idempotency latches,
              // so a recording can start between it and this admission. This
              // one can't be raced — and it guards the write, which is the step
              // that would otherwise sit on "Generating…" for half an hour.
              refuseWhenRecording: "generate this test",
            },
            async () =>
              withLock(specWriteKey(appId), async () => {
                const appPath = await getAppPath(appId);
                const raced = await findWrittenSpecForDraft(
                  appId,
                  appPath,
                  stored.draft,
                );
                if (raced) {
                  return {
                    specPath: raced.relativePath,
                    wroteIt: false,
                    racedProposalId: raced.proposalId,
                    fixtureChange: null,
                  };
                }
                const written = await writeRecordedSpec({
                  appId,
                  appPath,
                  draft: stored.draft,
                  proposalId,
                  bodyStatements: finalStatements,
                });
                return {
                  specPath: written.specPath,
                  wroteIt: true,
                  racedProposalId: null,
                  fixtureChange: written.fixtureChange,
                };
              }),
          );

        // Another card for this recording was approved while synthesis was in
        // the model. That file carries its plan, not this one's, so reporting
        // these assertions as applied would describe a spec that doesn't exist.
        // Latch the card against what is actually on disk and say so.
        //
        // Unless the marker names THIS proposal: then it is our own earlier
        // write, finished before the process died and never latched, and the
        // file holds exactly the plan being approved now.
        if (!wroteIt && racedProposalId === proposalId) {
          await persistApproval({
            row,
            proposalId,
            stored,
            items: stored.items,
            specPath,
          });
          return { specPath, appliedCount: countAssertions(stored.items) };
        }
        if (!wroteIt) {
          await persistApproval({
            row,
            proposalId,
            stored,
            // Steps only, for the same reason as the branch above: the file was
            // written from the other card's plan, so these checks are not in it.
            items: stored.items.filter((item) => item.kind === "step"),
            specPath,
          });
          return {
            specPath,
            appliedCount: 0,
            warning: `This recording was already saved as ${specPath}, so no assertions were added.`,
          };
        }

        try {
          await persistApproval({
            row,
            proposalId,
            stored,
            items: finalItems,
            specPath,
          });
        } catch (error) {
          // The card is still approvable, so a retry would claim the next free
          // filename and leave two copies behind. Undo the write, marker
          // included — a retry that found the marker would approve against a
          // file this just deleted.
          forgetRecordedDraftWrite(appId, stored.draft);
          // `writeRecordedSpec` also consumed the parked draft. Nothing was
          // written in the end, and the recorder bar is still up offering
          // "Generate test proposal" — a path that reads the parked draft in the
          // main process and would otherwise answer that there is no finished
          // recording waiting, about a recording that still exists.
          restoreRecordedTestDraft(appId, stored.draft);
          await discardGeneratedSpec(appId, specPath, fixtureChange);
          throw error;
        }

        // Approval happens entirely in the chat, so nothing else tells the
        // recording bar its draft is now a file. Without this it stays up
        // offering to propose the recording that has already been written.
        //
        // Broadcast rather than reply to the approving window: the bar belongs to
        // whichever window holds the preview, which need not be the one the chat
        // was approved in. Same reason `recording:draft-named` broadcasts.
        broadcastToAllWindows("recording:draft-consumed", {
          appId,
          draftId: stored.draft.draftId,
          specPath,
        });

        const appliedCount = countAssertions(finalItems);
        logger.info(
          `Generated ${specPath} with ${appliedCount} assertion(s) (chat ${chatId})`,
        );
        return { specPath, appliedCount, warning: synthesisWarning };
      }),
  );
}
