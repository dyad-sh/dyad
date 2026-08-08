import { describe, expect, it } from "vitest";
import {
  closeHermesWorkspaceTab,
  openHermesWorkspaceTab,
} from "./hermes_workspace_tabs";

describe("Hermes workspace tabs", () => {
  it("keeps open tabs in order and updates their visible metadata", () => {
    expect(
      openHermesWorkspaceTab([{ id: "a", name: "Old name", icon: "A" }], {
        id: "a",
        name: "Renamed",
        icon: "✨",
      }),
    ).toEqual([{ id: "a", name: "Renamed", icon: "✨" }]);
    expect(
      openHermesWorkspaceTab([{ id: "a", name: "Agent A", icon: "A" }], {
        id: "b",
        name: "Agent B",
        icon: "B",
      }),
    ).toEqual([
      { id: "a", name: "Agent A", icon: "A" },
      { id: "b", name: "Agent B", icon: "B" },
    ]);
  });

  it("selects the next agent when the active tab closes", () => {
    expect(closeHermesWorkspaceTab(["a", "b", "c"], "b", "b")).toEqual({
      openAgentIds: ["a", "c"],
      activeTab: "c",
    });
  });

  it("returns to the dashboard after the final chat closes", () => {
    expect(closeHermesWorkspaceTab(["a"], "a", "a")).toEqual({
      openAgentIds: [],
      activeTab: "dashboard",
    });
  });

  it("does not change the active tab when another chat closes", () => {
    expect(closeHermesWorkspaceTab(["a", "b"], "b", "dashboard")).toEqual({
      openAgentIds: ["a"],
      activeTab: "dashboard",
    });
  });
});
