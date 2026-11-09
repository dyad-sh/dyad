import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { pickWorkspaceId, toAppRelativePath } from "./chat_workspace_store";

describe("pickWorkspaceId", () => {
  it("takes the next id while its port slot is free", () => {
    expect(pickWorkspaceId({ lastId: 41, usedIds: [3, 17], slots: 1000 })).toBe(
      42,
    );
  });

  it("skips ids whose port slot a kept workspace already holds", () => {
    // Workspace 7 still exists, so 1007 would share its preview ports.
    expect(
      pickWorkspaceId({ lastId: 1006, usedIds: [7, 8], slots: 1000 }),
    ).toBe(1009);
  });

  it("never reuses an id, even once every slot is taken", () => {
    expect(
      pickWorkspaceId({ lastId: 9, usedIds: [1, 2, 3, 4], slots: 4 }),
    ).toBe(10);
  });
});

describe("toAppRelativePath", () => {
  it("rebases repository paths onto an app in a subfolder", () => {
    expect(
      toAppRelativePath({ appSubpath: "apps/web" }, "apps/web/src/App.tsx"),
    ).toBe("src/App.tsx");
    expect(toAppRelativePath({ appSubpath: "" }, "src/App.tsx")).toBe(
      "src/App.tsx",
    );
  });
});
