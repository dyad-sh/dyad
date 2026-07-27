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
});
