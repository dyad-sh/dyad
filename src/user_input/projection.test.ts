import { createStore, type WritableAtom } from "jotai";
import { describe, expect, it, vi } from "vitest";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { pendingQuestionnaireAtom } from "@/atoms/planAtoms";
import type {
  PendingUserInputPayload,
  UserInputDescriptorPayload,
} from "@/ipc/types/user_input";
import {
  getUserInputProjectionAdapter,
  respondingRequestIdsAtom,
  userInputRequestsAtom,
  type UserInputProjectionIpc,
  type UserInputRequests,
} from "./projection";

type RequestedListener = (payload: UserInputDescriptorPayload) => void;
type ArmedListener = (payload: {
  requestId: string;
  followUpPrompt: string;
}) => void;
type ClassifiedListener = (payload: {
  requestId: string;
  reason?: string;
}) => void;
type SettledListener = (payload: {
  requestId: string;
  outcome:
    | "human"
    | "classifier-approved"
    | "timed-out"
    | "swept"
    | "superseded"
    | "acknowledged"
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
    classifier: "none",
  };
}

function pending(
  descriptor: UserInputDescriptorPayload,
): PendingUserInputPayload {
  return {
    status: "awaiting",
    descriptor,
    deadlineAt: descriptor.deadlineAt,
    classifier: descriptor.classifier,
  };
}

function mcpDescriptor(requestId: string): UserInputDescriptorPayload {
  return {
    kind: "mcp-consent",
    requestId,
    chatId: 7,
    deadlineAt: 10_000,
    serverId: 1,
    serverName: "test server",
    toolName: "read_file",
    classifier: "racing",
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
    classifier: "none",
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
    classifier: "none",
    followUpPrompt: "Continue. I have completed the supabase integration.",
  };
}

function createFakeIpc() {
  const requested = new Set<RequestedListener>();
  const armed = new Set<ArmedListener>();
  const classified = new Set<ClassifiedListener>();
  const settled = new Set<SettledListener>();
  const followUpDue = new Set<FollowUpDueListener>();
  const getPending = vi.fn(
    (_input: undefined): Promise<PendingUserInputPayload[]> =>
      Promise.resolve([]),
  );
  const respond = vi.fn((): Promise<void> => Promise.resolve());
  const acceptFollowUp = vi.fn((): Promise<void> => Promise.resolve());
  const beginFollowUpExecution = vi.fn((): Promise<void> => Promise.resolve());
  const retryFollowUp = vi.fn((): Promise<void> => Promise.resolve());
  const rejectFollowUp = vi.fn((): Promise<void> => Promise.resolve());

  const subscribe = <T>(listeners: Set<T>, listener: T) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const ipcClient = {
    userInput: {
      getPending,
      respond,
      acceptFollowUp,
      beginFollowUpExecution,
      retryFollowUp,
      rejectFollowUp,
    },
    events: {
      userInput: {
        onRequested: (listener: RequestedListener) =>
          subscribe(requested, listener),
        onArmed: (listener: ArmedListener) => subscribe(armed, listener),
        onClassified: (listener: ClassifiedListener) =>
          subscribe(classified, listener),
        onSettled: (listener: SettledListener) => subscribe(settled, listener),
        onFollowUpDue: (listener: FollowUpDueListener) =>
          subscribe(followUpDue, listener),
      },
    },
  } as UserInputProjectionIpc;

  return {
    ipcClient,
    getPending,
    respond,
    sendRequested: (payload: UserInputDescriptorPayload) =>
      requested.forEach((listener) => listener(payload)),
    sendArmed: (payload: Parameters<ArmedListener>[0]) =>
      armed.forEach((listener) => listener(payload)),
    sendClassified: (payload: { requestId: string; reason?: string }) =>
      classified.forEach((listener) => listener(payload)),
    sendSettled: (payload: Parameters<SettledListener>[0]) =>
      settled.forEach((listener) => listener(payload)),
    sendFollowUpDue: (payload: Parameters<FollowUpDueListener>[0]) =>
      followUpDue.forEach((listener) => listener(payload)),
  };
}

describe("user-input renderer projection", () => {
  it("lets events received during hydration win by requestId", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    let resolveHydration!: (snapshots: PendingUserInputPayload[]) => void;
    fake.getPending.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHydration = resolve;
      }),
    );
    const adapter = getUserInputProjectionAdapter({
      store,
      ipcClient: fake.ipcClient,
    });
    const stop = adapter.start();

    fake.sendRequested(agentDescriptor("request-1", "new-tool"));
    resolveHydration([pending(agentDescriptor("request-1", "stale-tool"))]);

    await vi.waitFor(() => {
      const request = store.get(userInputRequestsAtom).get("request-1");
      expect(request?.status).toBe("awaiting");
      if (!request || request.status === "settled") return;
      expect(request.descriptor.kind).toBe("agent-consent");
      if (request.descriptor.kind === "agent-consent") {
        expect(request.descriptor.toolName).toBe("new-tool");
      }
    });
    stop();
  });

  it("exposes a read-only projection so rogue writers fail", () => {
    const store = createStore();
    const rogueWritable = userInputRequestsAtom as WritableAtom<
      UserInputRequests,
      [UserInputRequests],
      void
    >;

    expect(() => store.set(rogueWritable, new Map())).toThrow();
  });

  it("replays a classified event that beats its hydration snapshot", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    let resolveHydration!: (snapshots: PendingUserInputPayload[]) => void;
    fake.getPending.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHydration = resolve;
      }),
    );
    const adapter = getUserInputProjectionAdapter({
      store,
      ipcClient: fake.ipcClient,
    });
    const stop = adapter.start();

    fake.sendClassified({ requestId: "mcp-request", reason: "needs review" });
    resolveHydration([pending(mcpDescriptor("mcp-request"))]);

    await vi.waitFor(() => {
      const request = store.get(userInputRequestsAtom).get("mcp-request");
      expect(request?.status).toBe("awaiting");
      if (!request || request.status === "settled") return;
      expect(request.classifier).toBe("review");
      expect(request.classifierReason).toBe("needs review");
    });
    stop();
  });

  it("rehydrates the classifier review reason", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    fake.getPending.mockResolvedValueOnce([
      {
        ...pending(mcpDescriptor("review-request")),
        classifier: "review",
        classifierReason: "sensitive input",
      },
    ]);
    const adapter = getUserInputProjectionAdapter({
      store,
      ipcClient: fake.ipcClient,
    });
    const stop = adapter.start();

    await vi.waitFor(() => {
      const request = store.get(userInputRequestsAtom).get("review-request");
      expect(request?.status).toBe("awaiting");
      if (!request || request.status === "settled") return;
      expect(request.classifierReason).toBe("sensitive input");
    });
    stop();
  });

  it("rehydrates and toasts on NotFound without re-queueing", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    const showErrorToast = vi.fn();
    fake.respond.mockRejectedValueOnce(
      new DyadError("gone", DyadErrorKind.NotFound),
    );
    const adapter = getUserInputProjectionAdapter({
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
    expect(store.get(respondingRequestIdsAtom).has("expired-request")).toBe(
      false,
    );
    expect(store.get(userInputRequestsAtom).has("expired-request")).toBe(false);
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
    const adapter = getUserInputProjectionAdapter({
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

    expect(store.get(userInputRequestsAtom).has("expired-request")).toBe(false);
    expect(store.get(respondingRequestIdsAtom).has("expired-request")).toBe(
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
    const adapter = getUserInputProjectionAdapter({
      store,
      ipcClient: fake.ipcClient,
    });
    const stop = adapter.start();
    fake.sendRequested(agentDescriptor("request-2"));

    const response = adapter.respond("request-2", {
      kind: "agent-consent",
      decision: "decline",
    });
    expect(store.get(respondingRequestIdsAtom).has("request-2")).toBe(true);

    fake.sendSettled({ requestId: "request-2", outcome: "human" });
    resolveRespond();
    await expect(response).resolves.toBe(true);
    expect(store.get(respondingRequestIdsAtom).has("request-2")).toBe(false);
    expect(store.get(userInputRequestsAtom).get("request-2")?.status).toBe(
      "settled",
    );
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
    const adapter = getUserInputProjectionAdapter({
      store,
      ipcClient: fake.ipcClient,
    });
    const stop = adapter.start();
    fake.sendRequested(questionnaireDescriptor("questionnaire-responding"));

    const response = adapter.respond("questionnaire-responding", {
      kind: "questionnaire",
      answers: { framework: "Vue" },
    });

    expect(store.get(pendingQuestionnaireAtom).get(7)).toMatchObject({
      requestId: "questionnaire-responding",
      isResponding: true,
    });

    fake.sendSettled({
      requestId: "questionnaire-responding",
      outcome: "human",
    });
    resolveRespond();
    await expect(response).resolves.toBe(true);
    expect(store.get(pendingQuestionnaireAtom).has(7)).toBe(false);
    stop();
  });

  it("clears a questionnaire on main timeout and rejects a stale submit without confirmation", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    const showErrorToast = vi.fn();
    fake.respond.mockRejectedValueOnce(
      new DyadError("gone", DyadErrorKind.NotFound),
    );
    const adapter = getUserInputProjectionAdapter({
      store,
      ipcClient: fake.ipcClient,
      showErrorToast,
    });
    const stop = adapter.start();
    await vi.waitFor(() => expect(fake.getPending).toHaveBeenCalledTimes(1));

    fake.sendRequested(questionnaireDescriptor("questionnaire-1"));
    expect(store.get(pendingQuestionnaireAtom).has(7)).toBe(true);

    fake.sendSettled({
      requestId: "questionnaire-1",
      outcome: "timed-out",
    });
    expect(store.get(pendingQuestionnaireAtom).has(7)).toBe(false);

    await expect(
      adapter.respond("questionnaire-1", {
        kind: "questionnaire",
        answers: { framework: "Vue" },
      }),
    ).resolves.toBe(false);

    expect(showErrorToast).toHaveBeenCalledWith("request expired");
    expect(
      Array.from(store.get(userInputRequestsAtom).values()).some(
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
    const adapter = getUserInputProjectionAdapter({
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

    expect(
      store.get(userInputRequestsAtom).get("questionnaire-2"),
    ).toMatchObject({
      status: "settled",
      settledAt: 1_000,
      questionnaireSubmitted: true,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.get(userInputRequestsAtom).has("questionnaire-2")).toBe(false);
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
    const adapter = getUserInputProjectionAdapter({
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

    expect(
      store.get(userInputRequestsAtom).get("questionnaire-race"),
    ).toMatchObject({
      status: "settled",
      questionnaireSubmitted: false,
    });
    rejectRespond(new DyadError("gone", DyadErrorKind.NotFound));
    await expect(response).resolves.toBe(false);
    stop();
  });

  it("accepts a chat-stream facade after a child cached the adapter", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    const descriptor = integrationDescriptor("integration-late-facade");
    fake.getPending.mockResolvedValueOnce([
      {
        status: "due",
        descriptor,
        deadlineAt: descriptor.deadlineAt,
        followUpPrompt: descriptor.followUpPrompt,
      },
    ]);
    const adapter = getUserInputProjectionAdapter({
      store,
      ipcClient: fake.ipcClient,
    });
    const stop = adapter.start();
    await vi.waitFor(() => expect(fake.getPending).toHaveBeenCalledTimes(1));
    const submit = vi.fn();

    expect(
      getUserInputProjectionAdapter({
        store,
        ipcClient: fake.ipcClient,
        chatStream: { submit },
      }),
    ).toBe(adapter);

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "integration-late-facade" }),
    );
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
      const adapter = getUserInputProjectionAdapter({
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
          store.get(userInputRequestsAtom).get(descriptor.requestId)?.status,
        ).toBe("armed"),
      );
      stop();
    },
  );

  it("dispatches one due follow-up through the injected chat-stream facade", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    const submit = vi.fn();
    const adapter = getUserInputProjectionAdapter({
      store,
      ipcClient: fake.ipcClient,
      chatStream: { submit },
    });
    const stop = adapter.start();
    await vi.waitFor(() => expect(fake.getPending).toHaveBeenCalledTimes(1));
    fake.sendRequested(integrationDescriptor("integration-1"));

    const due = {
      requestId: "integration-1",
      chatId: 42,
      prompt: "Continue. I have completed the supabase integration.",
    };
    fake.sendFollowUpDue(due);
    fake.sendFollowUpDue(due);

    await vi.waitFor(() =>
      expect(submit).toHaveBeenCalledExactlyOnceWith({
        requestId: "integration-1",
        chatId: 42,
        prompt: due.prompt,
        selectedComponents: [],
        requestedChatMode: "local-agent",
      }),
    );
    expect(fake.respond).toHaveBeenCalledWith({
      requestId: "integration-1",
      response: { kind: "follow-up-dispatched" },
    });
    stop();
  });

  it("acknowledges a follow-up only after the facade reports durable acceptance", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    let accept!: () => void;
    const submit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          accept = resolve;
        }),
    );
    const adapter = getUserInputProjectionAdapter({
      store,
      ipcClient: fake.ipcClient,
      chatStream: { submit },
    });
    const stop = adapter.start();
    fake.sendRequested(integrationDescriptor("integration-acceptance"));
    fake.sendFollowUpDue({
      requestId: "integration-acceptance",
      chatId: 42,
      prompt: "Continue. I have completed the supabase integration.",
    });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(fake.respond).not.toHaveBeenCalledWith({
      requestId: "integration-acceptance",
      response: { kind: "follow-up-dispatched" },
    });

    accept();
    await vi.waitFor(() =>
      expect(fake.respond).toHaveBeenCalledWith({
        requestId: "integration-acceptance",
        response: { kind: "follow-up-dispatched" },
      }),
    );
    stop();
  });

  it("retries a due follow-up on window focus after dispatch fails", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    const dispatchError = new Error("accepted chunk transport failed");
    const submit = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(dispatchError)
      .mockResolvedValueOnce();
    const showErrorToast = vi.fn();
    const adapter = getUserInputProjectionAdapter({
      store,
      ipcClient: fake.ipcClient,
      chatStream: { submit },
      showErrorToast,
    });
    const stop = adapter.start();
    fake.sendRequested(integrationDescriptor("integration-retry"));
    fake.sendFollowUpDue({
      requestId: "integration-retry",
      chatId: 42,
      prompt: "Continue. I have completed the supabase integration.",
    });

    await vi.waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith(dispatchError),
    );
    expect(submit).toHaveBeenCalledTimes(1);
    expect(fake.respond).not.toHaveBeenCalledWith({
      requestId: "integration-retry",
      response: { kind: "follow-up-dispatched" },
    });

    window.dispatchEvent(new Event("focus"));

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(fake.respond).toHaveBeenCalledWith({
      requestId: "integration-retry",
      response: { kind: "follow-up-dispatched" },
    });
    stop();
  });

  it("rehydrates an armed continuation across remount and dispatches after stream end", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    const descriptor = integrationDescriptor("integration-2");
    fake.getPending.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        status: "armed",
        descriptor,
        deadlineAt: descriptor.deadlineAt,
        followUpPrompt: descriptor.followUpPrompt,
      },
    ]);
    const submit = vi.fn();
    const adapter = getUserInputProjectionAdapter({
      store,
      ipcClient: fake.ipcClient,
      chatStream: { submit },
    });
    const stopFirstMount = adapter.start();
    await vi.waitFor(() => expect(fake.getPending).toHaveBeenCalledTimes(1));
    fake.sendRequested(descriptor);

    await expect(
      adapter.respond("integration-2", {
        kind: "integration",
        provider: "supabase",
        completed: true,
      }),
    ).resolves.toBe(true);
    fake.sendArmed({
      requestId: "integration-2",
      followUpPrompt: descriptor.followUpPrompt!,
    });
    expect(store.get(userInputRequestsAtom).get("integration-2")?.status).toBe(
      "armed",
    );

    stopFirstMount();
    const stopSecondMount = adapter.start();
    await vi.waitFor(() => expect(fake.getPending).toHaveBeenCalledTimes(2));
    expect(store.get(userInputRequestsAtom).get("integration-2")?.status).toBe(
      "armed",
    );
    expect(submit).not.toHaveBeenCalled();

    fake.sendFollowUpDue({
      requestId: "integration-2",
      chatId: 42,
      prompt: descriptor.followUpPrompt!,
    });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    stopSecondMount();
  });

  it("dispatches a due continuation returned by getPending after reload", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    const descriptor = integrationDescriptor("integration-3");
    fake.getPending.mockResolvedValueOnce([
      {
        status: "due",
        descriptor,
        deadlineAt: descriptor.deadlineAt,
        followUpPrompt: descriptor.followUpPrompt,
      },
    ]);
    const submit = vi.fn();
    const adapter = getUserInputProjectionAdapter({
      store,
      ipcClient: fake.ipcClient,
      chatStream: { submit },
    });
    const stop = adapter.start();

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(fake.respond).toHaveBeenCalledWith({
      requestId: "integration-3",
      response: { kind: "follow-up-dispatched" },
    });
    stop();
  });

  it("replays one accepted handoff after renderer reload while dedup is pending", async () => {
    const store = createStore();
    const fake = createFakeIpc();
    const descriptor = integrationDescriptor("integration-accepted");
    fake.getPending.mockResolvedValueOnce([
      {
        status: "accepted",
        descriptor,
        deadlineAt: descriptor.deadlineAt,
        followUpPrompt: descriptor.followUpPrompt,
      },
    ]);
    let acknowledge!: () => void;
    const submit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const adapter = getUserInputProjectionAdapter({
      store,
      ipcClient: fake.ipcClient,
      chatStream: { submit },
    });
    const stop = adapter.start();

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("focus"));
    expect(submit).toHaveBeenCalledTimes(1);

    acknowledge();
    await vi.waitFor(() =>
      expect(fake.respond).toHaveBeenCalledWith({
        requestId: "integration-accepted",
        response: { kind: "follow-up-dispatched" },
      }),
    );
    stop();
  });
});
