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
import { E2E_TEST_DIR, SPEC_FILE_RE, testsContracts } from "../types/tests";
import type { ApplyTestAssertionsResult } from "../types/tests";
import { assertMutationPathAllowed, safeJoin } from "../utils/path_utils";
import { readContainedTextFile } from "../utils/bounded_text_file";
import { gitAdd } from "../utils/git_utils";
import { extractJson } from "../utils/extract_json";
import { getModelClient } from "../utils/get_model_client";
import { fastTextOutput } from "../utils/stream_text_utils";
import { getAiHeaders, getProviderOptions } from "../utils/provider_options";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  countAssertions,
  isAssertionItem,
  type AssertionPlanItem,
} from "@/lib/test_recorder/assertion_proposal";
import {
  isSingleAssertionStatement,
  parseGeneratedSpec,
  renderSpec,
  type ParsedSpec,
} from "@/lib/test_recorder/spec_edit";
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

const logger = log.scope("test_assertion_handlers");

const LLM_TIMEOUT_MS = 60_000;
const MAX_SPEC_BYTES = 1024 * 1024;

export const HAND_EDITED_MESSAGE =
  "Dyad can only place assertions in a test it generated. This spec has been " +
  "hand-edited, so edit it directly instead of proposing assertions for it.";

const rawCodeSchema = z.object({
  assertions: z
    .array(z.object({ id: z.string(), code: z.string() }))
    .default([]),
});

/** sha256 of a spec's source, used to detect edits between propose and apply. */
export function hashSpecSource(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Resolve + validate the app and spec path, and read + parse the spec source.
 * Shared with the agent's `generate_test_assertions` tool, which proposes the
 * plan this module later applies.
 *
 * Reads through `readContainedTextFile` rather than the editor reader: it is
 * symlink-contained and size-capped, and it *throws* instead of truncating —
 * splicing into a silently truncated file would destroy the user's test.
 */
export async function loadSpecForAssertions({
  appId,
  specPath,
}: {
  appId: number;
  specPath: string;
}): Promise<{ appPath: string; source: string; parsed: ParsedSpec }> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) {
    throw new DyadError(`App ${appId} not found`, DyadErrorKind.NotFound);
  }

  const normalized = specPath.split(path.sep).join("/");
  if (
    !normalized.startsWith(`${E2E_TEST_DIR}/`) ||
    !SPEC_FILE_RE.test(normalized)
  ) {
    throw new DyadError(
      `Not an E2E spec under ${E2E_TEST_DIR}/: ${specPath}`,
      DyadErrorKind.Validation,
    );
  }

  const appPath = getDyadAppPath(app.path);
  const source = await readContainedTextFile({
    rootPath: appPath,
    filePath: safeJoin(appPath, normalized),
    displayPath: normalized,
    maxBytes: MAX_SPEC_BYTES,
  });

  const parsed = parseGeneratedSpec(source);
  if (!parsed) {
    throw new DyadError(HAND_EDITED_MESSAGE, DyadErrorKind.Precondition);
  }
  return { appPath, source, parsed };
}

/** `loadSpecForAssertions` plus the chat-ownership check the apply path needs. */
async function loadSpecContext({
  appId,
  chatId,
  specPath,
}: {
  appId: number;
  chatId: number;
  specPath: string;
}): Promise<{ appPath: string; source: string; parsed: ParsedSpec }> {
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
  return loadSpecForAssertions({ appId, specPath });
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
 * assertions the user already reviewed still land.
 */
async function synthesizeAssertionCode({
  appId,
  parsed,
  specPath,
  items,
}: {
  appId: number;
  parsed: ParsedSpec;
  specPath: string;
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
        testTitle: parsed.testTitle,
        specPath,
        bodyStatements: parsed.bodyStatements,
        requests: pending.map((item) => ({
          id: item.id,
          afterStep: afterStepById.get(item.id) ?? -1,
          text: item.text,
        })),
      }),
      schema: rawCodeSchema,
    });
  } catch (error) {
    logger.warn(`Assertion code synthesis failed for ${specPath}:`, error);
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

export function registerTestAssertionHandlers() {
  createTypedHandler(
    testsContracts.applyTestAssertions,
    async (_event, params): Promise<ApplyTestAssertionsResult> => {
      const { appId, chatId, proposalId, items } = params;

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

      // Idempotent: a second approve (double click, stale card) is a no-op, not
      // an error.
      if (readAssertionsTagAttribute(row.content, "status") === "approved") {
        return {
          specPath: stored.specPath,
          appliedCount: countAssertions(stored.items),
          warning: "These assertions were already applied.",
        };
      }

      const { appPath, source, parsed } = await loadSpecContext({
        appId,
        chatId,
        specPath: stored.specPath,
      });

      if (hashSpecSource(source) !== stored.specHash) {
        throw new DyadError(
          `${stored.specPath} changed since these assertions were proposed. ` +
            `Ask the AI for assertions again.`,
          DyadErrorKind.Precondition,
        );
      }

      // Guard against a renderer that lost or duplicated a step: the recorded
      // interactions must survive the round-trip exactly.
      const submittedSteps = items
        .filter((item) => item.kind === "step")
        .map((item) => item.stepIndex);
      const expectedSteps = stored.items
        .filter((item) => item.kind === "step")
        .map((item) => item.stepIndex);
      if (
        submittedSteps.length !== expectedSteps.length ||
        new Set(submittedSteps).size !== expectedSteps.length
      ) {
        throw new DyadError(
          "The approved plan doesn't match the recorded steps.",
          DyadErrorKind.Validation,
        );
      }

      const withText = items.filter(
        (item) => item.kind === "step" || item.text.trim().length > 0,
      );
      const { codeById, warning: synthesisWarning } =
        await synthesizeAssertionCode({
          appId,
          parsed,
          specPath: stored.specPath,
          items: withText,
        });

      const finalItems: AssertionPlanItem[] = [];
      for (const item of withText) {
        if (item.kind === "step") {
          finalItems.push(item);
          continue;
        }
        const code =
          item.needsCode || !item.code ? codeById.get(item.id) : item.code;
        if (!code) continue; // synthesis failed or was rejected; already warned
        finalItems.push({ ...item, code, needsCode: false });
      }

      const appliedCount = countAssertions(finalItems);
      let nextSource = source;
      if (appliedCount > 0) {
        nextSource = renderSpec(parsed, finalItems);
        const relativePath = await assertMutationPathAllowed({
          appPath,
          relativePath: stored.specPath,
        });
        await fs.promises.writeFile(
          path.join(appPath, relativePath),
          nextSource,
          "utf-8",
        );
        // Stage for the normal uncommitted-changes review flow. Best-effort:
        // the file is already written, so a git hiccup must not fail the apply.
        try {
          await gitAdd({ path: appPath, filepath: relativePath });
        } catch (error) {
          logger.warn(
            `Wrote ${stored.specPath} but couldn't git-add it:`,
            error,
          );
        }
      }

      // Rewriting the tag is the durable approval latch: it survives a reload
      // and re-hydrates the card in its approved state. Splice it in place —
      // the tool emitted the card inside the agent's assistant message, so the
      // surrounding prose and any sibling tool cards must survive untouched.
      const approvedContent = replaceAssertionsTagInMessage(
        row.content,
        buildAssertionsTagContent({
          proposalId,
          status: "approved",
          payload: {
            ...stored,
            items: finalItems,
            specHash: hashSpecSource(nextSource),
          },
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

      logger.info(
        `Applied ${appliedCount} assertion(s) to ${stored.specPath} (chat ${chatId})`,
      );
      return {
        specPath: stored.specPath,
        appliedCount,
        warning:
          synthesisWarning ??
          (appliedCount === 0
            ? "No assertions were added — the test file is unchanged."
            : undefined),
      };
    },
  );
}
