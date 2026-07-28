import { describe, expect, it, vi } from "vitest";
import { ChatTabTransferCoordinator } from "./chat_tab_transfer_coordinator";
import { WindowRegistry, type WindowEndpoint } from "./window_registry";
import type {
  ChatTabTransferPayload,
  TabInstanceId,
  WindowSessionId,
} from "../types";

const session = (suffix: number) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}` as WindowSessionId;
const tab = (suffix: number) =>
  `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}` as TabInstanceId;

function endpoint(
  id: number,
): WindowEndpoint & { send: ReturnType<typeof vi.fn> } {
  return {
    id,
    isDestroyed: () => false,
    once: () => undefined,
    send: vi.fn(),
  };
}

function payload(): ChatTabTransferPayload {
  return {
    tabInstanceId: tab(1),
    chatId: 7,
    appId: 3,
    presentation: {
      draftInput: "unfinished",
      scrollTop: 420,
      selectedFile: { path: "src/App.tsx", line: 12 },
      editorCursor: {
        appId: 11,
        path: "src/App.tsx",
        lineNumber: 18,
        column: 7,
      },
      stagedDiffFile: null,
      previewHistory: ["http://localhost:3000", "http://localhost:3000/about"],
      previewHistoryPosition: 1,
      previewMode: "code",
      isPreviewOpen: true,
      isChatPanelHidden: false,
      terminalOpen: true,
      selectedComponents: [],
    },
  };
}

describe("ChatTabTransferCoordinator", () => {
  it("removes the source only after its correlated receipt", async () => {
    const windows = new WindowRegistry();
    const source = endpoint(1);
    const destination = endpoint(2);
    windows.register(source, session(1));
    windows.register(destination, session(2));
    const coordinator = new ChatTabTransferCoordinator(windows);

    coordinator.begin(
      "20000000-0000-4000-8000-000000000001",
      session(1),
      payload(),
    );
    expect(
      await coordinator.adopt(
        session(2),
        "20000000-0000-4000-8000-000000000001",
      ),
    ).toEqual(payload());
    expect(source.send).not.toHaveBeenCalled();

    const acknowledgement = coordinator.acknowledge(
      session(2),
      "20000000-0000-4000-8000-000000000001",
    );
    expect(source.send).toHaveBeenCalledWith(
      "window:chat-tab-transfer-remove-source",
      expect.objectContaining({ chatId: 7, tabInstanceId: tab(1) }),
    );
    coordinator.confirmSourceRemoval(session(1), {
      transferId: "20000000-0000-4000-8000-000000000001",
      chatId: 7,
      tabInstanceId: tab(1),
    });
    await acknowledgement;
  });

  it("keeps the source intact when adoption is rejected", async () => {
    const windows = new WindowRegistry();
    const source = endpoint(1);
    windows.register(source, session(1));
    windows.register(endpoint(2), session(2));
    const coordinator = new ChatTabTransferCoordinator(windows);
    const transferId = "20000000-0000-4000-8000-000000000002";

    coordinator.begin(transferId, session(1), payload());
    await coordinator.adopt(session(2), transferId);
    coordinator.reject(session(2), transferId);

    expect(source.send).not.toHaveBeenCalled();
    expect(await coordinator.adopt(session(2), transferId)).toEqual(payload());
    const acknowledgement = coordinator.acknowledge(session(2), transferId);
    coordinator.confirmSourceRemoval(session(1), {
      transferId,
      chatId: 7,
      tabInstanceId: tab(1),
    });
    await acknowledgement;
  });

  it("waits briefly when adoption arrives before registration", async () => {
    const windows = new WindowRegistry();
    windows.register(endpoint(1), session(1));
    windows.register(endpoint(2), session(2));
    const coordinator = new ChatTabTransferCoordinator(windows);
    const transferId = "20000000-0000-4000-8000-000000000003";

    const adoption = coordinator.adopt(session(2), transferId);
    coordinator.begin(transferId, session(1), payload());

    expect(await adoption).toEqual(payload());
    coordinator.reject(session(2), transferId);
  });

  it("rejects a reused transfer identifier without replacing its owner", async () => {
    const windows = new WindowRegistry();
    windows.register(endpoint(1), session(1));
    windows.register(endpoint(2), session(2));
    const coordinator = new ChatTabTransferCoordinator(windows);
    const transferId = "20000000-0000-4000-8000-000000000004";
    const originalPayload = payload();

    coordinator.begin(transferId, session(1), originalPayload);
    expect(() =>
      coordinator.begin(transferId, session(2), {
        ...payload(),
        tabInstanceId: tab(2),
      }),
    ).toThrowError(
      expect.objectContaining({
        kind: "conflict",
      }),
    );

    expect(await coordinator.adopt(session(2), transferId)).toEqual(
      originalPayload,
    );
    coordinator.reject(session(2), transferId);
  });

  it("accepts a correlated source confirmation after the receipt wait times out", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const windows = new WindowRegistry();
      windows.register(endpoint(1), session(1));
      windows.register(endpoint(2), session(2));
      const coordinator = new ChatTabTransferCoordinator(
        windows,
        () => now,
        100,
        10,
        5,
      );
      const transferId = "20000000-0000-4000-8000-000000000005";

      coordinator.begin(transferId, session(1), payload());
      await coordinator.adopt(session(2), transferId);
      const acknowledgement = coordinator.acknowledge(session(2), transferId);
      const timedOut = expect(acknowledgement).rejects.toMatchObject({
        kind: "precondition",
      });
      now = 6;
      await vi.advanceTimersByTimeAsync(5);
      await timedOut;

      expect(() =>
        coordinator.confirmSourceRemoval(session(1), {
          transferId,
          chatId: 7,
          tabInstanceId: tab(1),
        }),
      ).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a late source confirmation after the destination aborts", async () => {
    vi.useFakeTimers();
    try {
      const windows = new WindowRegistry();
      windows.register(endpoint(1), session(1));
      windows.register(endpoint(2), session(2));
      const coordinator = new ChatTabTransferCoordinator(
        windows,
        Date.now,
        100,
        10,
        5,
      );
      const transferId = "20000000-0000-4000-8000-000000000006";

      coordinator.begin(transferId, session(1), payload());
      await coordinator.adopt(session(2), transferId);
      const acknowledgement = coordinator.acknowledge(session(2), transferId);
      const timedOut = expect(acknowledgement).rejects.toMatchObject({
        kind: "precondition",
      });
      await vi.advanceTimersByTimeAsync(5);
      await timedOut;
      coordinator.reject(session(2), transferId);

      expect(() =>
        coordinator.confirmSourceRemoval(session(1), {
          transferId,
          chatId: 7,
          tabInstanceId: tab(1),
        }),
      ).toThrowError(expect.objectContaining({ kind: "conflict" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds unknown-transfer adoption waiters and releases their slots", async () => {
    vi.useFakeTimers();
    try {
      const windows = new WindowRegistry();
      windows.register(endpoint(1), session(1));
      windows.register(endpoint(2), session(2));
      const coordinator = new ChatTabTransferCoordinator(
        windows,
        Date.now,
        100,
        10,
        5,
        100,
        1,
      );
      const waitingId = "20000000-0000-4000-8000-000000000007";
      const firstAdoption = coordinator.adopt(session(2), waitingId);
      const firstRejection = expect(firstAdoption).rejects.toMatchObject({
        kind: "not_found",
      });

      await expect(
        coordinator.adopt(session(2), waitingId),
      ).rejects.toMatchObject({
        kind: "precondition",
      });
      await expect(
        coordinator.adopt(session(2), "20000000-0000-4000-8000-000000000008"),
      ).rejects.toMatchObject({
        kind: "precondition",
      });

      await vi.advanceTimersByTimeAsync(10);
      await firstRejection;

      const admittedId = "20000000-0000-4000-8000-000000000009";
      const admitted = coordinator.adopt(session(2), admittedId);
      coordinator.begin(admittedId, session(1), payload());
      await expect(admitted).resolves.toEqual(payload());
      coordinator.reject(session(2), admittedId);
    } finally {
      vi.useRealTimers();
    }
  });

  it("actively expires a cancelled drag without another protocol call", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const windows = new WindowRegistry();
      windows.register(endpoint(1), session(1));
      windows.register(endpoint(2), session(2));
      const coordinator = new ChatTabTransferCoordinator(
        windows,
        () => now,
        100,
        10,
      );
      const transferId = "20000000-0000-4000-8000-000000000010";
      coordinator.begin(transferId, session(1), payload());

      now = 101;
      await vi.advanceTimersByTimeAsync(100);
      const adoption = coordinator.adopt(session(2), transferId);
      const rejection = expect(adoption).rejects.toMatchObject({
        kind: "not_found",
      });
      await vi.advanceTimersByTimeAsync(10);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
