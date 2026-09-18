// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createUserInputRegistry } from "./registry";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
const state = vi.hoisted(() => ({ directory: "" }));
vi.mock("@/paths/paths", () => ({ getUserDataPath: () => state.directory }));
import {
  persistQuestionnaire,
  recoverQuestionnaires,
  settleQuestionnaire,
} from "./questionnaire_journal";
beforeEach(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), "dyad-questionnaire-"));
});
afterEach(async () => {
  await rm(state.directory, { recursive: true, force: true });
});
const questions = [
  { id: "q", type: "text" as const, question: "Which color?" },
];

it("persists answers before returning the parked result and refuses duplicate/late answers", async () => {
  const clock = createFakeClock(0);
  const registry = createUserInputRegistry({
    clock,
    idSource: createSequentialIdSource(),
    broadcast: vi.fn(),
    persistOutcome: (descriptor, value) =>
      settleQuestionnaire(descriptor.requestId, value, descriptor.chatId),
  });
  await persistQuestionnaire({
    requestId: "request",
    chatId: 1,
    questions,
    outcome: "pending",
  });
  registry.request(
    { kind: "questionnaire", chatId: 1, questions, classifier: "none" },
    "request",
  );
  const parked = registry.park("request");
  clock.advanceBy(6 * 60_000);
  expect(registry.getPending()).toHaveLength(1);
  // A new renderer can rediscover the same pending descriptor.
  expect(registry.getPending()[0].descriptor.requestId).toBe("request");
  await registry.respond("request", {
    kind: "questionnaire",
    answers: { q: "blue" },
  });
  await expect(parked).resolves.toMatchObject({ answers: { q: "blue" } });
  await registry
    .respond("request", { kind: "questionnaire", answers: { q: "red" } })
    .catch(() => {});
  expect(await recoverQuestionnaires(1)).toMatchObject([
    { outcome: "answered", answers: { q: "blue" } },
  ]);
});

it("records dismissal, cancellation and restart interruption without replaying a request", async () => {
  for (const requestId of ["dismiss", "cancel", "restart"])
    await persistQuestionnaire({
      requestId,
      chatId: 1,
      questions,
      outcome: "pending",
    });
  await settleQuestionnaire(
    "dismiss",
    {
      kind: "questionnaire",
      answers: null,
    },
    1,
  );
  await settleQuestionnaire("cancel", null, 1);
  const receipts = await recoverQuestionnaires(1);
  expect(
    Object.fromEntries(receipts.map((r) => [r.requestId, r.outcome])),
  ).toEqual({
    dismiss: "dismissed",
    cancel: "interrupted",
    restart: "interrupted",
  });
  await settleQuestionnaire(
    "restart",
    {
      kind: "questionnaire",
      answers: { q: "late" },
    },
    1,
  );
  expect(await recoverQuestionnaires(1)).toEqual(receipts);
  expect(await recoverQuestionnaires(2)).toEqual([]);
});

it("keeps failed human answers pending and retries without losing or duplicating them", async () => {
  const broadcast = vi.fn();
  const onCommandError = vi.fn();
  const persistOutcome = vi
    .fn()
    .mockRejectedValueOnce(new Error("disk full"))
    .mockResolvedValue(undefined);
  const registry = createUserInputRegistry({
    clock: createFakeClock(0),
    idSource: createSequentialIdSource(),
    broadcast,
    persistOutcome,
    onCommandError,
  });
  registry.request(
    { kind: "questionnaire", chatId: 1, questions, classifier: "none" },
    "retry",
  );
  const parked = registry.park("retry");
  let settled = false;
  void parked.then(() => {
    settled = true;
  });
  const answer = { kind: "questionnaire" as const, answers: { q: "blue" } };
  await expect(registry.respond("retry", answer)).rejects.toThrow("disk full");
  expect(settled).toBe(false);
  expect(registry.getPending()).toHaveLength(1);
  expect(onCommandError).toHaveBeenCalledOnce();
  expect(
    broadcast.mock.calls.filter(([name]) => name === "user-input:settled"),
  ).toHaveLength(0);
  const outcomes = await Promise.allSettled([
    registry.respond("retry", answer),
    registry.respond("retry", answer),
  ]);
  expect(outcomes.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
  await expect(parked).resolves.toEqual(answer);
  expect(registry.getPending()).toHaveLength(0);
  registry.dispose();
});

it("drains cancellation even if its interruption receipt cannot be written", async () => {
  const onCommandError = vi.fn();
  const registry = createUserInputRegistry({
    clock: createFakeClock(0),
    idSource: createSequentialIdSource(),
    broadcast: vi.fn(),
    persistOutcome: async () => {
      throw new Error("storage unavailable");
    },
    onCommandError,
  });
  registry.request(
    { kind: "questionnaire", chatId: 1, questions, classifier: "none" },
    "cancel-failed",
  );
  const parked = registry.park("cancel-failed");
  await registry.settleChat(1);
  await expect(parked).resolves.toBeNull();
  expect(onCommandError).toHaveBeenCalledOnce();
  expect(registry.getPending()).toHaveLength(0);
  registry.dispose();
});
