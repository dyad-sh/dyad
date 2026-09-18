import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { UserInputQuestionSchema } from "@/ipc/types/user_input";
import { getUserDataPath } from "@/paths/paths";
import type { UserInputQuestion, UserInputParkValue } from "./state";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export interface QuestionnaireReceipt {
  requestId: string;
  chatId: number;
  questions: UserInputQuestion[];
  outcome: "pending" | "answered" | "dismissed" | "interrupted";
  answers?: Record<string, string>;
  createdAt?: number;
}
const receiptSchema = z.object({
  requestId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  chatId: z.number().int().positive().safe(),
  questions: z.array(UserInputQuestionSchema).min(1).max(5),
  outcome: z.enum(["pending", "answered", "dismissed", "interrupted"]),
  answers: z.record(z.string(), z.string()).optional(),
  createdAt: z.number().finite().optional(),
});
const directory = () => path.join(getUserDataPath(), "questionnaire-receipts");
function chatDirectory(chatId: number) {
  if (!Number.isSafeInteger(chatId) || chatId <= 0)
    throw new DyadError("Invalid questionnaire chat", DyadErrorKind.Validation);
  return path.join(directory(), String(chatId));
}
function file(chatId: number, requestId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(requestId))
    throw new DyadError(
      "Invalid questionnaire identity",
      DyadErrorKind.Validation,
    );
  return path.join(chatDirectory(chatId), `${requestId}.json`);
}
// Upgrade the old flat directory once per process, never once per turn.
const migrations = new Map<string, Promise<void>>();
async function migrateLegacyReceipts() {
  const root = directory();
  let migration = migrations.get(root);
  if (!migration) {
    migration = (async () => {
      let names: string[];
      try {
        names = await readdir(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      // Flat temporary files belong to a process-dead, uncommitted write.
      for (const name of names.filter((n) => n.endsWith(".json.tmp")))
        await rm(path.join(root, name), { force: true });
      for (const name of names.filter((n) => n.endsWith(".json"))) {
        const source = path.join(root, name);
        const raw = await readFile(source, "utf8");
        let receipt: QuestionnaireReceipt;
        try {
          receipt = receiptSchema.parse(JSON.parse(raw));
        } catch {
          await rm(source, { force: true });
          continue;
        }
        receipt.createdAt ??= (await stat(source)).mtimeMs;
        try {
          await stat(file(receipt.chatId, receipt.requestId));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          await writeReceipt(receipt);
        }
        await rm(source, { force: true });
      }
    })().catch((error) => {
      migrations.delete(root);
      throw error;
    });
    migrations.set(root, migration);
  }
  await migration;
}
async function writeReceipt(receipt: QuestionnaireReceipt) {
  const destination = file(receipt.chatId, receipt.requestId);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(
    destination + ".tmp",
    JSON.stringify({ ...receipt, createdAt: receipt.createdAt ?? Date.now() }),
    { mode: 0o600 },
  );
  await rename(destination + ".tmp", destination);
}
export async function persistQuestionnaire(receipt: QuestionnaireReceipt) {
  receiptSchema.parse(receipt);
  await migrateLegacyReceipts();
  await writeReceipt(receipt);
  // Bounded retention applies to regular Dyad as well as Claude. Never prune
  // pending requests, and never turn a successful answer save into a failure
  // merely because retention cleanup failed.
  await pruneReceipts(receipt.chatId).catch(() => {});
}
async function pruneReceipts(chatId: number) {
  const names = await readdir(chatDirectory(chatId));
  const settled: QuestionnaireReceipt[] = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const receipt = receiptSchema.parse(
      JSON.parse(
        await readFile(path.join(chatDirectory(chatId), name), "utf8"),
      ),
    );
    if (receipt.outcome !== "pending") settled.push(receipt);
  }
  settled.sort(
    (a, b) =>
      (b.createdAt ?? 0) - (a.createdAt ?? 0) ||
      b.requestId.localeCompare(a.requestId),
  );
  for (const receipt of settled.slice(50))
    await rm(file(chatId, receipt.requestId), { force: true });
}
export async function settleQuestionnaire(
  requestId: string,
  value: UserInputParkValue | null,
  chatId: number,
) {
  await migrateLegacyReceipts();
  let receipt: QuestionnaireReceipt;
  try {
    receipt = receiptSchema.parse(
      JSON.parse(await readFile(file(chatId, requestId), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new DyadError(
        "Questionnaire receipt is missing. Retry after restoring storage access.",
        DyadErrorKind.Precondition,
      );
    throw error;
  }
  if (receipt.outcome !== "pending") return;
  const answers = value?.kind === "questionnaire" ? value.answers : null;
  await persistQuestionnaire({
    ...receipt,
    outcome: answers ? "answered" : value ? "dismissed" : "interrupted",
    ...(answers ? { answers } : {}),
  });
}
/** A dead MCP request is never replayed. Its durable human outcome becomes
 * context for a fresh CLI session, not permission to repeat operations. */
export async function recoverQuestionnaires(
  chatId: number,
): Promise<QuestionnaireReceipt[]> {
  await migrateLegacyReceipts();
  let names: string[];
  try {
    names = await readdir(chatDirectory(chatId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const receipts: QuestionnaireReceipt[] = [];
  for (const name of names.filter((name) => name.endsWith(".json"))) {
    let receipt: QuestionnaireReceipt;
    try {
      receipt = receiptSchema.parse(
        JSON.parse(
          await readFile(path.join(chatDirectory(chatId), name), "utf8"),
        ),
      );
    } catch {
      continue;
    }
    if (receipt.chatId !== chatId) continue;
    if (receipt.outcome === "pending") {
      receipt.outcome = "interrupted";
      await persistQuestionnaire(receipt);
    }
    receipts.push(receipt);
  }
  receipts.sort(
    (a, b) =>
      (a.createdAt ?? 0) - (b.createdAt ?? 0) ||
      a.requestId.localeCompare(b.requestId),
  );
  for (const receipt of receipts.slice(0, -50))
    await rm(file(chatId, receipt.requestId), { force: true });
  return receipts.slice(-50);
}

/** Call only after the chat's input/turn owners have drained. */
export async function deleteQuestionnaires(chatId: number) {
  await migrateLegacyReceipts();
  await rm(chatDirectory(chatId), { recursive: true, force: true });
}
