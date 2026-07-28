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
      const transferId = "20000000-0000-4000-8000-000000000004";
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
