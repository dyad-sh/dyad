// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Response as NodeResponse } from "node-fetch";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { UserSettings } from "@/lib/schemas";
import { DyadErrorKind } from "@/errors/dyad_error";
const mocks = vi.hoisted(() => ({ credits: vi.fn(), key: "checked-dyad-key" }));
vi.mock("node-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node-fetch")>()),
  default: mocks.credits,
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    providerSettings: { auto: { apiKey: { value: mocks.key } } },
  }),
}));
vi.mock("./codex_subscription_account", () => ({
  getSubscriptionAccount: async () => ({
    connected: true,
    models: ["test-model"],
  }),
  markSubscriptionLimited: vi.fn(),
}));
vi.mock("./codex_subscription_auth", () => ({
  getCodexSubscriptionCredentials: async () => ({
    access: "test-access",
    accountId: "test-account",
  }),
}));
vi.mock("../shared/language_model_helpers", () => ({
  getLanguageModels: async () => [],
  getLanguageModelProviders: async () => [
    ...["custom", "lmstudio", "ollama"].map((id) => ({
      id,
      name: id,
      type: id === "custom" ? "custom" : "local",
      apiBaseUrl: "http://localhost:1234/v1",
    })),
    { id: "auto", name: "Dyad", type: "cloud", gatewayPrefix: "dyad/" },
    { id: "openai", name: "OpenAI", type: "cloud", gatewayPrefix: "" },
  ],
}));
vi.mock("../shared/remote_language_model_catalog", () => ({
  resolveBuiltinModelAlias: async (alias: string) =>
    alias === "dyad/auto/openai"
      ? { providerId: "openai", apiName: "test-model" }
      : null,
}));
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      warn: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    }),
  },
}));
import { preflightSubscriptionTurn } from "./subscription_turn_preflight";
import {
  checkExternalModelAdmission,
  type ExternalModelAdmission,
} from "./external_model_admission";
import {
  startExternalModelUsage,
  interruptExternalModelUsage,
} from "./external_model_usage";
import {
  getModelClient,
  setModelClientFetchForTesting,
} from "../utils/get_model_client";
import type { AutoModelCandidates } from "./auto_model_candidates";

const signal = () => new AbortController().signal;
const balance = () =>
  new NodeResponse(
    JSON.stringify({
      totalCredits: 100,
      usedCredits: 1,
      budgetResetDate: "2026-10-01",
      userId: "test-user",
    }),
  );
const denied = () => new NodeResponse("out of credits", { status: 402 });
const billing = { connection: "local" as const, modelProvider: "ollama" };
const settings = () =>
  ({
    enableDyadPro: true,
    proModelUsage: "subscription",
    selectedChatMode: "ask",
    providerSettings: {
      auto: { apiKey: { value: mocks.key } },
      custom: { apiKey: { value: "provider-key" } },
    },
  }) as unknown as UserSettings;
beforeEach(() => {
  mocks.key = "checked-dyad-key";
  mocks.credits.mockReset().mockImplementation(async () => balance());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setModelClientFetchForTesting(undefined);
});

it.each(["openai", "ollama", "lmstudio", "custom", "auto"])(
  "%s carries preflight admission into exactly its first external request",
  async (provider) => {
    const candidates: AutoModelCandidates = new Map();
    const turnSignal = signal();
    const admitted = await preflightSubscriptionTurn(
      {
        provider,
        name: provider === "auto" ? "auto" : "test-model",
        effortLevel: "medium",
      },
      settings(),
      turnSignal,
      candidates,
    );
    expect(admitted.externalModelAdmission).toBeDefined();
    expect(mocks.credits).toHaveBeenCalledTimes(1);
    // A duplicate post-acceptance lookup would now reject the accepted turn.
    mocks.credits.mockImplementation(async () => denied());
    const inference = vi.fn(
      async () =>
        new Response("", { headers: { "Content-Type": "text/event-stream" } }),
    );
    vi.stubGlobal("fetch", inference);
    setModelClientFetchForTesting(inference);
    const createClient = async () =>
      (
        await getModelClient(admitted.model, settings(), admitted.model, {
          chatId: 42,
          autoModelCandidates: candidates,
          externalModelAdmission: admitted.externalModelAdmission,
        })
      ).modelClient.model as LanguageModelV3;
    const first = await (
      await createClient()
    ).doStream({ prompt: [], abortSignal: turnSignal });
    await first.stream.cancel();
    expect(inference).toHaveBeenCalledTimes(1);
    expect(mocks.credits).toHaveBeenCalledTimes(1);
    // Rebuilding the client must not recreate the admission for the next agent step.
    await expect(
      (await createClient()).doStream({ prompt: [], abortSignal: turnSignal }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
    expect(mocks.credits).toHaveBeenCalledTimes(2);
    expect(inference).toHaveBeenCalledTimes(1);
  },
);

it.each(["outage", "timeout", "malformed"])(
  "retains preflight's fail-open admission after %s",
  async (failure) => {
    if (failure === "outage")
      mocks.credits.mockRejectedValueOnce(new Error("offline"));
    if (failure === "timeout")
      mocks.credits.mockRejectedValueOnce(
        new DOMException("Timed out", "TimeoutError"),
      );
    if (failure === "malformed")
      mocks.credits.mockResolvedValueOnce(
        new NodeResponse('{"totalCredits":null}'),
      );
    const admitted = await preflightSubscriptionTurn(
      { provider: "openai", name: "test-model", effortLevel: "medium" },
      settings(),
      signal(),
    );
    mocks.credits.mockImplementation(async () => denied());
    const id = await startExternalModelUsage(
      "test-model",
      undefined,
      undefined,
      mocks.key,
      admitted.externalModelAdmission,
    );
    interruptExternalModelUsage(id, true);
    expect(mocks.credits).toHaveBeenCalledTimes(1);
    await expect(
      startExternalModelUsage(
        "test-model",
        undefined,
        undefined,
        mocks.key,
        admitted.externalModelAdmission,
      ),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
  },
);

it("does not mint admission after confirmed denial", async () => {
  mocks.credits.mockResolvedValueOnce(denied());
  await expect(
    checkExternalModelAdmission(mocks.key, signal()),
  ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
});

it("requires a fresh check for another account and retires the mismatched admission", async () => {
  const admission = await checkExternalModelAdmission(mocks.key, signal());
  mocks.credits.mockImplementation(async () => denied());
  await expect(
    startExternalModelUsage(
      "test-model",
      undefined,
      billing,
      "different-key",
      admission,
    ),
  ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
  expect(mocks.credits.mock.calls[1][1].headers.Authorization).toBe(
    "Bearer different-key",
  );
  await expect(
    startExternalModelUsage(
      "test-model",
      undefined,
      billing,
      mocks.key,
      admission,
    ),
  ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
  expect(mocks.credits).toHaveBeenCalledTimes(3);
});

it("only one concurrent request can consume admission", async () => {
  const admission = await checkExternalModelAdmission(mocks.key, signal());
  mocks.credits.mockImplementation(async () => denied());
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      startExternalModelUsage(
        "test-model",
        undefined,
        billing,
        mocks.key,
        admission,
      ),
    ),
  );
  expect(results.map((result) => result.status)).toEqual([
    "fulfilled",
    "rejected",
  ]);
  if (results[0].status === "fulfilled")
    interruptExternalModelUsage(results[0].value, true);
  expect(mocks.credits).toHaveBeenCalledTimes(2);
});

it.each([undefined, {} as ExternalModelAdmission])(
  "checks callers without a valid minted admission (%j)",
  async (admission) => {
    mocks.credits.mockImplementation(async () => denied());
    await expect(
      startExternalModelUsage(
        "test-model",
        undefined,
        billing,
        mocks.key,
        admission,
      ),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
    expect(mocks.credits).toHaveBeenCalledTimes(1);
  },
);

it("does not honor admission after its turn is cancelled", async () => {
  const controller = new AbortController();
  const admission = await checkExternalModelAdmission(
    mocks.key,
    controller.signal,
  );
  controller.abort();
  await expect(
    startExternalModelUsage(
      "test-model",
      controller.signal,
      billing,
      mocks.key,
      admission,
    ),
  ).rejects.toMatchObject({ kind: DyadErrorKind.UserCancelled });
  mocks.credits.mockImplementation(async () => denied());
  await expect(
    startExternalModelUsage(
      "test-model",
      signal(),
      billing,
      mocks.key,
      admission,
    ),
  ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
});

it("subscription nonstreaming requests consume admission through their stream adapter", async () => {
  const admitted = await preflightSubscriptionTurn(
    { provider: "openai", name: "test-model", effortLevel: "medium" },
    settings(),
    signal(),
  );
  mocks.credits.mockImplementation(async () => denied());
  const inference = vi.fn(
    async () =>
      new Response(
        "data: " +
          JSON.stringify({
            type: "response.completed",
            response: {
              id: "response-test",
              created_at: 1,
              model: "test-model",
              status: "completed",
              output: [],
              usage: {
                input_tokens: 1,
                output_tokens: 1,
                input_tokens_details: { cached_tokens: 0 },
              },
            },
          }) +
          "\n\n",
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/track-usage")
        ? Response.json({ chargedUsd: 0 })
        : inference(),
    ),
  );
  const { modelClient } = await getModelClient(
    admitted.model,
    settings(),
    admitted.model,
    { chatId: 42, externalModelAdmission: admitted.externalModelAdmission },
  );
  const model = modelClient.model as LanguageModelV3;
  await expect(model.doGenerate({ prompt: [] })).resolves.toMatchObject({
    content: [],
  });
  expect(inference).toHaveBeenCalledTimes(1);
  expect(mocks.credits).toHaveBeenCalledTimes(1);
  await expect(model.doGenerate({ prompt: [] })).rejects.toMatchObject({
    kind: DyadErrorKind.Precondition,
  });
  expect(inference).toHaveBeenCalledTimes(1);
});

it("subscription requests cannot spend another account's admission after a settings change", async () => {
  const admitted = await preflightSubscriptionTurn(
    { provider: "openai", name: "test-model", effortLevel: "medium" },
    settings(),
    signal(),
  );
  mocks.key = "changed-account-key";
  mocks.credits.mockImplementation(async () => denied());
  const inference = vi.fn();
  vi.stubGlobal("fetch", inference);
  const { modelClient } = await getModelClient(
    admitted.model,
    settings(),
    admitted.model,
    { chatId: 42, externalModelAdmission: admitted.externalModelAdmission },
  );
  await expect(
    (modelClient.model as LanguageModelV3).doStream({ prompt: [] }),
  ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
  expect(mocks.credits.mock.calls[1][1].headers.Authorization).toBe(
    "Bearer changed-account-key",
  );
  expect(inference).not.toHaveBeenCalled();
});
