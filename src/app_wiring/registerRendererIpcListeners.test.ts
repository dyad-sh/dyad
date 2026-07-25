import { QueryClient } from "@tanstack/react-query";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { ChatStreamManager } from "@/chat_stream/manager";
import type { StreamRequest } from "@/chat_stream/state";

import {
  createUserInputChatStreamFacade,
  registerQueryInvalidationListener,
  type RendererIpcClient,
} from "./registerRendererIpcListeners";
import { queryKeys } from "@/lib/queryKeys";
import type {
  QueryInvalidationBatch,
  WindowSessionId,
} from "@/window_infrastructure/types";

describe("query invalidation listener", () => {
  it("replays startup batches and carries its epoch across re-registration", async () => {
    let onInvalidations!: (batch: QueryInvalidationBatch) => void;
    let resolveBootstrap!: (value: {
      windowSessionId: WindowSessionId;
      currentQueryInvalidationEpoch: number;
      missedInvalidations: QueryInvalidationBatch["invalidations"];
      recoveryScopes: QueryInvalidationBatch["recoveryScopes"];
    }) => void;
    const bootstrap = vi.fn(
      () =>
        new Promise<{
          windowSessionId: WindowSessionId;
          currentQueryInvalidationEpoch: number;
          missedInvalidations: QueryInvalidationBatch["invalidations"];
          recoveryScopes: QueryInvalidationBatch["recoveryScopes"];
        }>((resolve) => {
          resolveBootstrap = resolve;
        }),
    );
    const ipcClient = {
      windowInfrastructure: { bootstrap },
      events: {
        windowInfrastructure: {
          onQueryInvalidations: vi.fn((listener) => {
            onInvalidations = listener;
            return vi.fn();
          }),
        },
      },
    } as unknown as Pick<RendererIpcClient, "windowInfrastructure" | "events">;
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue();
    const sessionId = randomUUID() as WindowSessionId;
    const event = { epoch: 1, scopes: [{ family: "apps" as const }] };

    const dispose = registerQueryInvalidationListener(ipcClient, queryClient);
    expect(bootstrap).toHaveBeenCalledWith({
      lastSeenQueryInvalidationEpoch: 0,
    });
    onInvalidations({ invalidations: [event], recoveryScopes: [] });
    resolveBootstrap({
      windowSessionId: sessionId,
      currentQueryInvalidationEpoch: 1,
      missedInvalidations: [event],
      recoveryScopes: [],
    });
    await vi.waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: queryKeys.apps.all,
      });
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    dispose();

    const disposeReplacement = registerQueryInvalidationListener(
      ipcClient,
      queryClient,
    );
    expect(bootstrap).toHaveBeenLastCalledWith({
      lastSeenQueryInvalidationEpoch: 1,
    });
    disposeReplacement();
  });

  it("retries a failed bootstrap without retaining stale pending batches", async () => {
    let onInvalidations!: (batch: QueryInvalidationBatch) => void;
    const sessionId = randomUUID() as WindowSessionId;
    const bootstrap = vi
      .fn()
      .mockRejectedValueOnce(new Error("main not ready"))
      .mockResolvedValue({
        windowSessionId: sessionId,
        currentQueryInvalidationEpoch: 1,
        missedInvalidations: [
          { epoch: 1, scopes: [{ family: "apps" as const }] },
        ],
        recoveryScopes: [],
      });
    const ipcClient = {
      windowInfrastructure: { bootstrap },
      events: {
        windowInfrastructure: {
          onQueryInvalidations: vi.fn((listener) => {
            onInvalidations = listener;
            return vi.fn();
          }),
        },
      },
    } as unknown as Pick<RendererIpcClient, "windowInfrastructure" | "events">;
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const dispose = registerQueryInvalidationListener(ipcClient, queryClient, {
      initialDelayMs: 0,
      maximumDelayMs: 0,
    });
    onInvalidations({
      invalidations: [{ epoch: 1, scopes: [{ family: "chats" }] }],
      recoveryScopes: [],
    });

    await vi.waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: queryKeys.apps.all,
      }),
    );
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: queryKeys.chats.all,
    });

    dispose();
    consoleError.mockRestore();
  });
});

describe("user-input chat-stream composition facade", () => {
  it("claims rejection before awaiting owner settlement", async () => {
    let submitted!: StreamRequest;
    const chatStreamManager = {
      ensure: () => ({
        send: (event: { type: string; request: StreamRequest }) => {
          submitted = event.request;
        },
      }),
    } as unknown as ChatStreamManager;
    let settleRejection!: () => void;
    const rejectFollowUp = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settleRejection = resolve;
        }),
    );
    const facade = createUserInputChatStreamFacade(
      {
        userInput: { rejectFollowUp },
      } as unknown as Pick<RendererIpcClient, "userInput">,
      chatStreamManager,
    );
    const submission = facade.submit({
      requestId: "integration:1",
      chatId: 1,
      prompt: "continue",
      selectedComponents: [],
      requestedChatMode: "local-agent",
    });

    const rejection = submitted.onAcceptanceRejected?.("removed from queue");
    submitted.onAccepted?.();
    submitted.onAcceptanceError?.(new Error("late stream error"));
    settleRejection();
    await rejection;

    await expect(submission).resolves.toEqual({ accepted: false });
    expect(rejectFollowUp).toHaveBeenCalledWith({
      requestId: "integration:1",
      reason: "removed from queue",
    });
  });

  it("propagates owner settlement failure to the queue and submitter", async () => {
    let submitted!: StreamRequest;
    const chatStreamManager = {
      ensure: () => ({
        send: (event: { type: string; request: StreamRequest }) => {
          submitted = event.request;
        },
      }),
    } as unknown as ChatStreamManager;
    const settlementError = new Error("reject IPC failed");
    const facade = createUserInputChatStreamFacade(
      {
        userInput: {
          rejectFollowUp: vi.fn(() => Promise.reject(settlementError)),
        },
      } as unknown as Pick<RendererIpcClient, "userInput">,
      chatStreamManager,
    );
    const submission = facade.submit({
      requestId: "integration:2",
      chatId: 1,
      prompt: "continue",
      selectedComponents: [],
      requestedChatMode: "local-agent",
    });

    const rejection = submitted.onAcceptanceRejected?.("removed from queue");

    await Promise.all([
      expect(rejection).rejects.toBe(settlementError),
      expect(submission).rejects.toBe(settlementError),
    ]);
  });
});
