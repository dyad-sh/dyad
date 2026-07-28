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
  it("removes the source only after destination acknowledgement", () => {
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
      coordinator.adopt(session(2), "20000000-0000-4000-8000-000000000001"),
    ).toEqual(payload());
    expect(source.send).not.toHaveBeenCalled();

    coordinator.acknowledge(session(2), "20000000-0000-4000-8000-000000000001");
    expect(source.send).toHaveBeenCalledWith(
      "window:chat-tab-transfer-remove-source",
      expect.objectContaining({ chatId: 7, tabInstanceId: tab(1) }),
    );
  });

  it("keeps the source intact when adoption is rejected", () => {
    const windows = new WindowRegistry();
    const source = endpoint(1);
    windows.register(source, session(1));
    windows.register(endpoint(2), session(2));
    const coordinator = new ChatTabTransferCoordinator(windows);
    const transferId = "20000000-0000-4000-8000-000000000002";

    coordinator.begin(transferId, session(1), payload());
    coordinator.adopt(session(2), transferId);
    coordinator.reject(session(2), transferId);

    expect(source.send).not.toHaveBeenCalled();
    expect(coordinator.adopt(session(2), transferId)).toEqual(payload());
  });
});
