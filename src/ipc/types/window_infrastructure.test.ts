import { describe, expect, it } from "vitest";
import { windowInfrastructureContracts } from "./window_infrastructure";

describe("window infrastructure contracts", () => {
  it("allows C4 product-window creation for app and chat surfaces", () => {
    expect(
      windowInfrastructureContracts.openEntityInNewWindow.input.safeParse({
        kind: "app",
        id: 7,
      }).success,
    ).toBe(true);
    expect(
      windowInfrastructureContracts.openEntityInNewWindow.input.safeParse({
        kind: "chat",
        id: 11,
      }).success,
    ).toBe(true);
  });

  it("carries the owning app for restored chat navigation", () => {
    expect(
      windowInfrastructureContracts.bootstrap.output.safeParse({
        windowSessionId: "10000000-0000-4000-8000-000000000001",
        currentQueryInvalidationEpoch: 0,
        missedInvalidations: [],
        recoveryScopes: [],
        initialEntity: { kind: "chat", id: 11 },
        initialChatAppId: 7,
        mayMigrateLegacyChatTabSession: false,
        restorableWindowSessionIds: ["10000000-0000-4000-8000-000000000001"],
      }).success,
    ).toBe(true);
  });

  it("bounds renderer chat tab ownership snapshots", () => {
    const tab = {
      chatId: 11,
      tabInstanceId: "10000000-0000-4000-8000-000000000011",
    };
    expect(
      windowInfrastructureContracts.setChatTabOwnership.input.safeParse([tab])
        .success,
    ).toBe(true);
    const tooManyTabs = Array.from({ length: 101 }, (_, index) => ({
      chatId: index + 1,
      tabInstanceId: crypto.randomUUID(),
    }));
    expect(
      windowInfrastructureContracts.setChatTabOwnership.input.safeParse(
        tooManyTabs,
      ).success,
    ).toBe(false);
    expect(
      windowInfrastructureContracts.beginChatTabTransfer.input.safeParse({
        transferId: crypto.randomUUID(),
        tabs: tooManyTabs,
        payload: {
          ...tab,
          appId: 7,
          presentation: {
            draftInput: "",
            messageScrollTop: 0,
            file: null,
            editorCursor: null,
            preview: {
              history: [],
              position: -1,
              mode: "preview",
              open: false,
            },
            chatPanelHidden: false,
            terminalOpen: false,
            selectedComponents: [],
          },
        },
      }).success,
    ).toBe(false);
  });
});
