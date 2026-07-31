import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type {
  PendingUserInputPayload,
  UserInputDescriptorPayload,
} from "@/ipc/types/user_input";
import {
  getUserInputReadModel,
  type UserInputReadModelIpc,
} from "./read_model";
import { selectPendingQuestionnaires } from "./selectors";

type JotaiStore = ReturnType<typeof createStore>;

function snapshotFor(store: JotaiStore) {
  return getUserInputReadModel({ store }).getSnapshot();
}

type RequestedListener = (payload: UserInputDescriptorPayload) => void;
type ArmedListener = (payload: {
  requestId: string;
  followUpPrompt: string;
}) => void;
type SettledListener = (payload: {
  requestId: string;
  outcome:
    | "human"
    | "timed-out"
    | "swept"
    | "superseded"
    | "dispatched"
    | "rejected";
}) => void;
type FollowUpDueListener = (payload: {
  requestId: string;
  chatId: number;
  prompt: string;
}) => void;

function agentDescriptor(
  requestId: string,
  toolName = "read_file",
): UserInputDescriptorPayload {
  return {
    kind: "agent-consent",
    requestId,
    chatId: 7,
    deadlineAt: 10_000,
    toolName,
  };
}

function pending(
  descriptor: UserInputDescriptorPayload,
): PendingUserInputPayload {
  return {
    status: "awaiting",
    descriptor,
    deadlineAt: descriptor.deadlineAt,
  };
}

function questionnaireDescriptor(
  requestId: string,
): UserInputDescriptorPayload {
  return {
    kind: "questionnaire",
    requestId,
    chatId: 7,
    deadlineAt: 10_000,
    questions: [
      {
        id: "framework",
        type: "radio",
        question: "Which framework?",
        options: ["React", "Vue"],
      },
    ],
  };
}

function integrationDescriptor(requestId: string): UserInputDescriptorPayload {
  return {
    kind: "integration",
    requestId,
    chatId: 42,
    deadlineAt: 30_000,
    provider: "supabase",
    followUpPrompt: "Continue. I have completed the supabase integration.",
  };
}

function createFakeIpc() {
  const requested = new Set<RequestedListener>();
  const armed = new Set<ArmedListener>();
  const settled = new Set<SettledListener>();
  const followUpDue = new Set<FollowUpDueListener>();
  const getPending = vi.fn(
    (_input: undefined): Promise<PendingUserInputPayload[]> =>
      Promise.resolve([]),
  );
  const respond = vi.fn((): Promise<void> => Promise.resolve());
  const rejectFollowUp = vi.fn((): Promise<void> => Promise.resolve());

  const subscribe = <T>(listeners: Set<T>, listener: T) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const ipcClient = {
    userInput: {
      getPending,
      respond,
      rejectFollowUp,
    },
    events: {
      userInput: {
        onRequested: (listener: RequestedListener) =>
          subscribe(requested, listener),
        onArmed: (listener: ArmedListener) => subscribe(armed, listener),
        onSettled: (listener: SettledListener) => subscribe(settled, listener),
        onFollowUpDue: (listener: FollowUpDueListener) =>
          subscribe(followUpDue, listener),
      },
    },
  } as UserInputReadModelIpc;

  return {
    ipcClient,
    getPending,
    respond,
    sendRequested: (payload: UserInputDescriptorPayload) =>
      requested.forEach((listener) => listener(payload)),
    sendArmed: (payload: Parameters<ArmedListener>[0]) =>
      armed.forEach((listener) => listener(payload)),
    sendSettled: (payload: Parameters<SettledListener>[0]) =>
      settled.forEach((listener) => listener(payload)),
    sendFollowUpDue: (payload: Parameters<FollowUpDueListener>[0]) =>
      followUpDue.forEach((listener) => listener(payload)),
  };
}

describe("user-input renderer read model", () => {
  it("lets events received during hydration win by requestId", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    let resolveHydration!: (snapshots: PendingUserInputPayload[]) => void;
    fake.getPending.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHydration = resolve;
      }),
    );
    const adapter = getUserInputReadModel({
      store,
      ipcClient: fake.ipcClient,
    });
    const stop = adapter.start();

    fake.sendRequested(agentDescriptor("request-1", "new-tool"));
    resolveHydration([pending(agentDescriptor("request-1", "stale-tool"))]);

    await vi.waitFor(() => {
      const request = snapshotFor(store).requests.get("request-1");
      expect(request?.status).toBe("awaiting");
      if (!request || request.status === "settled") return;
      expect(request.descriptor.kind).toBe("agent-consent");
      if (request.descriptor.kind === "agent-consent") {
        expect(request.descriptor.toolName).toBe("new-tool");
      }
    });
    stop();
  });

  it("exposes a read-only public snapshot API", () => {
    const store = createStore();
    const readModel = getUserInputReadModel({ store });
    expect(readModel).not.toHaveProperty("setState");
    expect(readModel.getSnapshot().requests).toEqual(new Map());
  });

  it("keeps snapshot identity for buffered events with no visible request", () => {
    const store = createStore();
    const fake = createFakeIpc();
    const readModel = getUserInputReadModel({
      store,
      ipcClient: fake.ipcClient,
    });
    const stop = readModel.start();
    const initial = readModel.getSnapshot();
    const listener = vi.fn();
    const unsubscribe = readModel.subscribe(listener);

    fake.sendArmed({
      requestId: "buffered",
      followUpPrompt: "Continue",
    });
    fake.sendFollowUpDue({ requestId: "buffered", chatId: 7, prompt: "Go" });

    expect(readModel.getSnapshot()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
    stop();
  });

  it("rehydrates and toasts on NotFound without re-queueing", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    const showErrorToast = vi.fn();
    fake.respond.mockRejectedValueOnce(
      new DyadError("gone", DyadErrorKind.NotFound),
    );
    const adapter = getUserInputReadModel({
      store,
      ipcClient: fake.ipcClient,
      showErrorToast,
    });
    const stop = adapter.start();
    await vi.waitFor(() => expect(fake.getPending).toHaveBeenCalledTimes(1));
    fake.sendRequested(agentDescriptor("expired-request"));

    await expect(
      adapter.respond("expired-request", {
        kind: "agent-consent",
        decision: "accept-once",
      }),
    ).resolves.toBe(false);

    expect(fake.getPending).toHaveBeenCalledTimes(2);
    expect(showErrorToast).toHaveBeenCalledWith("request expired");
    expect(snapshotFor(store).respondingRequestIds.has("expired-request")).toBe(
      false,
    );
    expect(snapshotFor(store).requests.has("expired-request")).toBe(false);
    stop();
  });

  it("keeps an expired request hidden when the NotFound refresh fails", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    const showErrorToast = vi.fn();
    fake.respond.mockRejectedValueOnce(
      new DyadError("gone", DyadErrorKind.NotFound),
    );
    fake.getPending
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("renderer IPC unavailable"));
    const adapter = getUserInputReadModel({
      store,
      ipcClient: fake.ipcClient,
      showErrorToast,
    });
    const stop = adapter.start();
    await vi.waitFor(() => expect(fake.getPending).toHaveBeenCalledTimes(1));
    fake.sendRequested(agentDescriptor("expired-request"));

    await expect(
      adapter.respond("expired-request", {
        kind: "agent-consent",
        decision: "accept-once",
      }),
    ).resolves.toBe(false);

    expect(snapshotFor(store).requests.has("expired-request")).toBe(false);
    expect(snapshotFor(store).respondingRequestIds.has("expired-request")).toBe(
      false,
    );
    expect(showErrorToast).toHaveBeenCalledWith("request expired");
    stop();
  });

  it("keeps the optimistic overlay until the settled broadcast", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    let resolveRespond!: () => void;
    fake.respond.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRespond = resolve;
      }),
    );
    const adapter = getUserInputReadModel({
      store,
      ipcClient: fake.ipcClient,
    });
    const stop = adapter.start();
    fake.sendRequested(agentDescriptor("request-2"));
    const observed: ReturnType<typeof adapter.getSnapshot>[] = [];
    const unsubscribe = adapter.subscribe(() => {
      observed.push(adapter.getSnapshot());
    });

    const response = adapter.respond("request-2", {
      kind: "agent-consent",
      decision: "decline",
    });
    expect(snapshotFor(store).respondingRequestIds.has("request-2")).toBe(true);

    fake.sendSettled({ requestId: "request-2", outcome: "human" });
    resolveRespond();
    await expect(response).resolves.toBe(true);
    expect(snapshotFor(store).respondingRequestIds.has("request-2")).toBe(
      false,
    );
    expect(snapshotFor(store).requests.get("request-2")?.status).toBe(
      "settled",
    );
    expect(
      observed.some(
        (snapshot) =>
          snapshot.requests.get("request-2")?.status === "settled" &&
          snapshot.respondingRequestIds.has("request-2"),
      ),
    ).toBe(false);
    unsubscribe();
    stop();
  });

  it("keeps a questionnaire visible and marks it responding until settlement", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    let resolveRespond!: () => void;
    fake.respond.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRespond = resolve;
      }),
    );
    const adapter = getUserInputReadModel({
      store,
      ipcClient: fake.ipcClient,
    });
    const stop = adapter.start();
    fake.sendRequested(questionnaireDescriptor("questionnaire-responding"));

    const response = adapter.respond("questionnaire-responding", {
      kind: "questionnaire",
      answers: { framework: "Vue" },
    });

    expect(
      selectPendingQuestionnaires(snapshotFor(store)).get(7),
    ).toMatchObject({
      requestId: "questionnaire-responding",
      isResponding: true,
    });

    fake.sendSettled({
      requestId: "questionnaire-responding",
      outcome: "human",
    });
    resolveRespond();
    await expect(response).resolves.toBe(true);
    expect(selectPendingQuestionnaires(snapshotFor(store)).has(7)).toBe(false);
    stop();
  });

  it("clears a questionnaire on main timeout and rejects a stale submit without confirmation", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    const showErrorToast = vi.fn();
    fake.respond.mockRejectedValueOnce(
      new DyadError("gone", DyadErrorKind.NotFound),
    );
    const adapter = getUserInputReadModel({
      store,
      ipcClient: fake.ipcClient,
      showErrorToast,
    });
    const stop = adapter.start();
    await vi.waitFor(() => expect(fake.getPending).toHaveBeenCalledTimes(1));

    fake.sendRequested(questionnaireDescriptor("questionnaire-1"));
    expect(selectPendingQuestionnaires(snapshotFor(store)).has(7)).toBe(true);

    fake.sendSettled({
      requestId: "questionnaire-1",
      outcome: "timed-out",
    });
    expect(selectPendingQuestionnaires(snapshotFor(store)).has(7)).toBe(false);

    await expect(
      adapter.respond("questionnaire-1", {
        kind: "questionnaire",
        answers: { framework: "Vue" },
      }),
    ).resolves.toBe(false);

    expect(showErrorToast).toHaveBeenCalledWith("request expired");
    expect(
      Array.from(snapshotFor(store).requests.values()).some(
        (request) =>
          request.status === "settled" && request.questionnaireSubmitted,
      ),
    ).toBe(false);
    stop();
  });

  it("retains a successful questionnaire settlement for one confirmation animation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const store = createStore();
    const fake = createFakeIpc();
    const adapter = getUserInputReadModel({
      store,
      ipcClient: fake.ipcClient,
    });
    const stop = adapter.start();
    await vi.advanceTimersByTimeAsync(0);

    fake.sendRequested(questionnaireDescriptor("questionnaire-2"));
    const response = adapter.respond("questionnaire-2", {
      kind: "questionnaire",
      answers: { framework: "Vue" },
    });
    fake.sendSettled({ requestId: "questionnaire-2", outcome: "human" });
    await expect(response).resolves.toBe(true);

    expect(snapshotFor(store).requests.get("questionnaire-2")).toMatchObject({
      status: "settled",
      settledAt: 1_000,
      questionnaireSubmitted: true,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(snapshotFor(store).requests.has("questionnaire-2")).toBe(false);
    stop();
    vi.useRealTimers();
  });

  it("never confirms a questionnaire when timeout wins an in-flight response", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    let rejectRespond!: (error: unknown) => void;
    fake.respond.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectRespond = reject;
      }),
    );
    const adapter = getUserInputReadModel({
      store,
      ipcClient: fake.ipcClient,
      showErrorToast: vi.fn(),
    });
    const stop = adapter.start();
    fake.sendRequested(questionnaireDescriptor("questionnaire-race"));

    const response = adapter.respond("questionnaire-race", {
      kind: "questionnaire",
      answers: { framework: "Vue" },
    });
    fake.sendSettled({
      requestId: "questionnaire-race",
      outcome: "timed-out",
    });

    expect(snapshotFor(store).requests.get("questionnaire-race")).toMatchObject(
      {
        status: "settled",
        questionnaireSubmitted: false,
      },
    );
    rejectRespond(new DyadError("gone", DyadErrorKind.NotFound));
    await expect(response).resolves.toBe(false);
    stop();
  });

  it.each(["awaiting", "armed"] as const)(
    "does not let a buffered armed event lose to a %s hydration snapshot",
    async (hydratedStatus) => {
      const store = createStore();
      const fake = createFakeIpc();
      const descriptor = integrationDescriptor("integration-hydration-race");
      let resolveHydration!: (snapshots: PendingUserInputPayload[]) => void;
      fake.getPending.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveHydration = resolve;
        }),
      );
      const adapter = getUserInputReadModel({
        store,
        ipcClient: fake.ipcClient,
      });
      const stop = adapter.start();
      fake.sendArmed({
        requestId: descriptor.requestId,
        followUpPrompt: descriptor.followUpPrompt!,
      });
      resolveHydration([
        {
          ...pending(descriptor),
          status: hydratedStatus,
          followUpPrompt:
            hydratedStatus === "armed" ? descriptor.followUpPrompt : undefined,
        },
      ]);

      await vi.waitFor(() =>
        expect(
          snapshotFor(store).requests.get(descriptor.requestId)?.status,
        ).toBe("armed"),
      );
      stop();
    },
  );
});
