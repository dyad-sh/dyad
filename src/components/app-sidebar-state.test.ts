import { describe, expect, it } from "vitest";
import {
  getRouteSidebarPanel,
  getSelectedSidebarPanel,
  isSidebarItemActive,
  shouldShowSelectedAppChatList,
} from "@/components/app-sidebar-state";

describe("app sidebar state", () => {
  it("folds chat routes into the Apps panel", () => {
    expect(getRouteSidebarPanel("/chat")).toBe("Apps");
    expect(isSidebarItemActive({ title: "Apps", pathname: "/chat" })).toBe(
      true,
    );
  });

  it("selects Apps for app routes when the sidebar is expanded", () => {
    expect(
      getSelectedSidebarPanel({
        hoverState: "no-hover",
        sidebarState: "expanded",
        pathname: "/app-details",
      }),
    ).toBe("Apps");
    expect(
      getSelectedSidebarPanel({
        hoverState: "no-hover",
        sidebarState: "expanded",
        pathname: "/apps",
      }),
    ).toBe("Apps");
  });

  it("shows the selected app chat list only inside Apps with an app selected", () => {
    expect(
      shouldShowSelectedAppChatList({
        selectedPanel: "Apps",
        selectedAppId: 1,
        pathname: "/app-details",
      }),
    ).toBe(true);
    expect(
      shouldShowSelectedAppChatList({
        selectedPanel: "Apps",
        selectedAppId: null,
        pathname: "/app-details",
      }),
    ).toBe(false);
    expect(
      shouldShowSelectedAppChatList({
        selectedPanel: "Settings",
        selectedAppId: 1,
        pathname: "/app-details",
      }),
    ).toBe(false);
    expect(
      shouldShowSelectedAppChatList({
        selectedPanel: "Apps",
        selectedAppId: 1,
        pathname: "/",
      }),
    ).toBe(false);
    expect(
      shouldShowSelectedAppChatList({
        selectedPanel: "Apps",
        selectedAppId: 1,
        pathname: "/apps",
      }),
    ).toBe(false);
    expect(
      shouldShowSelectedAppChatList({
        selectedPanel: "Apps",
        selectedAppId: 1,
        pathname: "/chat",
      }),
    ).toBe(true);
  });
});
