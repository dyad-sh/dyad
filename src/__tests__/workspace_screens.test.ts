import { describe, expect, it } from "vitest";

import {
  closeScreenTab,
  isChatOwnedPath,
  openScreenTab,
  screenForPath,
  type ScreenTab,
} from "@/lib/workspace_screens";

describe("screenForPath", () => {
  it("finds the screen for a path", () => {
    expect(screenForPath("/settings")?.title).toBe("Settings");
    expect(screenForPath("/knowledge-base")?.title).toBe("Knowledge Base");
  });

  it("prefers the more specific screen", () => {
    // /coder/helix must not be swallowed by /coder.
    expect(screenForPath("/coder/helix")?.title).toBe("Helix");
    expect(screenForPath("/coder")?.title).toBe("Coding Agents");
  });

  it("matches nested routes to their screen", () => {
    expect(screenForPath("/settings/providers/openai")?.title).toBe("Settings");
  });

  it("returns nothing for an unknown path", () => {
    expect(screenForPath("/nowhere")).toBeUndefined();
  });

  it("does not match a path that merely shares a prefix", () => {
    expect(screenForPath("/settings-other")).toBeUndefined();
  });
});

describe("isChatOwnedPath", () => {
  it("claims the routes that manage their own tabs", () => {
    expect(isChatOwnedPath("/")).toBe(true);
    expect(isChatOwnedPath("/chat-agent")).toBe(true);
    expect(isChatOwnedPath("/agent-os")).toBe(true);
    expect(isChatOwnedPath("/chat/42")).toBe(true);
  });

  it("leaves other screens alone", () => {
    expect(isChatOwnedPath("/settings")).toBe(false);
    expect(isChatOwnedPath("/coder/helix")).toBe(false);
  });
});

describe("openScreenTab", () => {
  const helix = screenForPath("/coder/helix")!;
  const settings = screenForPath("/settings")!;

  it("adds a tab", () => {
    expect(openScreenTab([], helix)).toEqual([
      { path: "/coder/helix", title: "Helix" },
    ]);
  });

  it("does not open the same screen twice", () => {
    const once = openScreenTab([], helix);
    expect(openScreenTab(once, helix)).toBe(once);
  });

  it("keeps the order screens were opened in", () => {
    const tabs = openScreenTab(openScreenTab([], helix), settings);
    expect(tabs.map((tab) => tab.path)).toEqual(["/coder/helix", "/settings"]);
  });
});

describe("closeScreenTab", () => {
  const tabs: ScreenTab[] = [
    { path: "/a", title: "A" },
    { path: "/b", title: "B" },
    { path: "/c", title: "C" },
  ];

  it("removes the tab", () => {
    expect(closeScreenTab(tabs, "/b").tabs.map((t) => t.path)).toEqual([
      "/a",
      "/c",
    ]);
  });

  it("falls back to the tab on the right", () => {
    expect(closeScreenTab(tabs, "/b").fallback?.path).toBe("/c");
  });

  it("falls back to the left when closing the last tab", () => {
    expect(closeScreenTab(tabs, "/c").fallback?.path).toBe("/b");
  });

  it("has nowhere to fall back to when the last tab closes", () => {
    const single: ScreenTab[] = [{ path: "/a", title: "A" }];
    const result = closeScreenTab(single, "/a");
    expect(result.tabs).toEqual([]);
    expect(result.fallback).toBeNull();
  });

  it("ignores a tab that is not open", () => {
    const result = closeScreenTab(tabs, "/missing");
    expect(result.tabs).toBe(tabs);
    expect(result.fallback).toBeNull();
  });
});

describe("the coder screens", () => {
  it("gives Build Studio its own tab instead of the Agents launcher's", () => {
    // Prefix matching used to fold /coder/studio into the /coder tab, so
    // opening the coder replaced the launcher rather than joining it.
    expect(screenForPath("/coder/studio")?.title).toBe("Build Studio");
    expect(screenForPath("/coder")?.title).toBe("Coding Agents");
  });

  it("gives Helix and OpenWorker their own tabs too", () => {
    expect(screenForPath("/coder/helix")?.title).toBe("Helix");
    expect(screenForPath("/coder/openworker")?.title).toBe("OpenWorker");
  });
});
