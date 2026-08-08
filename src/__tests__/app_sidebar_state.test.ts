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
    expect(
      isSidebarItemActive({ title: "Coding Agent", pathname: "/chat" }),
    ).toBe(true);
  });

  it("selects Apps for app routes when the sidebar is expanded", () => {
    expect(
      getSelectedSidebarPanel({
        sidebarState: "expanded",
        pathname: "/app-details",
      }),
    ).toBe("Apps");
    expect(
      getSelectedSidebarPanel({
        sidebarState: "expanded",
        pathname: "/apps",
      }),
    ).toBeNull();
  });

  it("highlights My Apps nav item on the gallery route", () => {
    expect(isSidebarItemActive({ title: "My Apps", pathname: "/apps" })).toBe(
      true,
    );
    expect(
      isSidebarItemActive({ title: "Coding Agent", pathname: "/apps" }),
    ).toBe(false);
  });

  it("highlights agent nav items on their routes", () => {
    expect(isSidebarItemActive({ title: "Chat Agent", pathname: "/" })).toBe(
      true,
    );
    expect(
      isSidebarItemActive({ title: "Coding Agent", pathname: "/coder" }),
    ).toBe(true);
    expect(
      isSidebarItemActive({ title: "Chat Agent", pathname: "/chat-agent" }),
    ).toBe(true);
    expect(
      isSidebarItemActive({
        title: "Planner",
        pathname: "/planner",
      }),
    ).toBe(true);
  });

  it("keeps Storage selected across its landing page and workspaces", () => {
    expect(
      isSidebarItemActive({ title: "Storage", pathname: "/storage" }),
    ).toBe(true);
    expect(
      isSidebarItemActive({ title: "Storage", pathname: "/meta-hd" }),
    ).toBe(true);
    expect(isSidebarItemActive({ title: "Storage", pathname: "/vector" })).toBe(
      true,
    );
    expect(
      isSidebarItemActive({ title: "Storage", pathname: "/settings" }),
    ).toBe(false);
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
        pathname: "/coder",
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
