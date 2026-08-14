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
    // The gallery moved under Storage, so that is the entry it lights.
    expect(isSidebarItemActive({ title: "Storage", pathname: "/apps" })).toBe(
      true,
    );
    expect(
      isSidebarItemActive({ title: "Coding Agent", pathname: "/apps" }),
    ).toBe(false);
  });

  it("highlights agent nav items on their routes", () => {
    // "/" is the dashboard now, so it lights that entry rather than Chat.
    expect(isSidebarItemActive({ title: "Dashboard", pathname: "/" })).toBe(
      true,
    );
    expect(
      isSidebarItemActive({ title: "Dashboard", pathname: "/dashboard" }),
    ).toBe(true);
    expect(isSidebarItemActive({ title: "Chat Agent", pathname: "/" })).toBe(
      false,
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

  it("keeps System selected across every technical destination", () => {
    // The old routes still exist so existing links keep working; each must
    // still light up an entry rather than leaving the rail looking inactive.
    for (const pathname of [
      "/system",
      "/data-sources",
      "/infrastructure",
      // /settings renders System too.
      "/settings",
    ]) {
      expect(isSidebarItemActive({ title: "System", pathname }), pathname).toBe(
        true,
      );
    }

    // The drive and the vector store are Storage destinations, so they light
    // Storage. System claiming them left it lit on pages it does not own.
    for (const pathname of ["/meta-hd", "/vector"]) {
      expect(
        isSidebarItemActive({ title: "Storage", pathname }),
        pathname,
      ).toBe(true);
      expect(isSidebarItemActive({ title: "System", pathname }), pathname).toBe(
        false,
      );
    }

    // Storage has its own rail entry, so it lights that one and not System.
    expect(
      isSidebarItemActive({ title: "Storage", pathname: "/storage" }),
    ).toBe(true);
    expect(isSidebarItemActive({ title: "System", pathname: "/storage" })).toBe(
      false,
    );
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
