import { describe, expect, it } from "vitest";
import { windowInfrastructureContracts } from "./window_infrastructure";

describe("window infrastructure contracts", () => {
  it("limits C4a product-window creation to app surfaces", () => {
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
    ).toBe(false);
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
});
