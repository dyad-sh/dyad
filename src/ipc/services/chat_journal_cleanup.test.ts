// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
const config = vi.hoisted(() => ({ directory: "" }));
vi.mock("@/paths/paths", () => ({ getUserDataPath: () => config.directory }));
import { deleteChatJournals } from "./chat_journal_cleanup";
import {
  persistQuestionnaire,
  recoverQuestionnaires,
} from "@/user_input/questionnaire_journal";
beforeEach(async () => {
  config.directory = await mkdtemp(
    path.join(tmpdir(), "dyad-journal-cleanup-"),
  );
});
afterEach(async () => {
  await rm(config.directory, { recursive: true, force: true });
});
const questions = [{ id: "q", type: "text" as const, question: "Color?" }];
it("removes a chat's new and legacy journals without deleting another chat's data", async () => {
  await mkdir(path.join(config.directory, "questionnaire-receipts"));
  for (const chatId of [1, 2]) {
    await writeFile(
      path.join(
        config.directory,
        "questionnaire-receipts",
        `legacy-${chatId}.json`,
      ),
      JSON.stringify({
        requestId: `legacy-${chatId}`,
        chatId,
        questions,
        outcome: "answered",
        answers: { q: "private" },
      }),
    );
    for (const directory of ["plan-handoffs", "claude-sessions"]) {
      await mkdir(path.join(config.directory, directory), { recursive: true });
      await writeFile(
        path.join(config.directory, directory, `${chatId}.json`),
        "private",
      );
      await writeFile(
        path.join(config.directory, directory, `${chatId}.json.tmp`),
        "partial",
      );
    }
  }
  await deleteChatJournals(1);
  await deleteChatJournals(1);
  expect(await recoverQuestionnaires(1)).toEqual([]);
  expect(await recoverQuestionnaires(2)).toHaveLength(1);
  for (const directory of ["plan-handoffs", "claude-sessions"]) {
    expect(await readdir(path.join(config.directory, directory))).toEqual([
      "2.json",
      "2.json.tmp",
    ]);
  }
  expect(
    await readdir(path.join(config.directory, "questionnaire-receipts")),
  ).toEqual(["2"]);
});
it("retains the latest 50 by timestamp rather than UUID filename order, scoped to the chat", async () => {
  for (let i = 0; i < 55; i++)
    await persistQuestionnaire({
      requestId: `z-${100 - i}`,
      chatId: 1,
      questions,
      outcome: "answered",
      answers: { q: String(i) },
      createdAt: i,
    });
  await persistQuestionnaire({
    requestId: "other",
    chatId: 2,
    questions,
    outcome: "answered",
    createdAt: 0,
  });
  const receipts = await recoverQuestionnaires(1);
  expect(receipts.map((r) => r.createdAt)).toEqual(
    Array.from({ length: 50 }, (_, i) => i + 5),
  );
  expect(
    await readdir(path.join(config.directory, "questionnaire-receipts", "1")),
  ).toHaveLength(50);
  // Recovery no longer scans unrelated chat receipts.
  await writeFile(
    path.join(config.directory, "questionnaire-receipts", "2", "other.json"),
    "broken",
  );
  expect(await recoverQuestionnaires(1)).toHaveLength(50);
  expect(
    await readFile(
      path.join(config.directory, "questionnaire-receipts", "2", "other.json"),
      "utf8",
    ),
  ).toBe("broken");
});
