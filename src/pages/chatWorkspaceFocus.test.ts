import { describe, expect, it } from "vitest";
import { shouldFocusWorkspacePane } from "./chatWorkspaceFocus";

describe("workspace pane focus", () => {
  it("ignores programmatic focus but accepts user focus intent", () => {
    expect(shouldFocusWorkspacePane("focus", false)).toBe(false);
    expect(shouldFocusWorkspacePane("focus", true)).toBe(true);
    expect(shouldFocusWorkspacePane("pointer", false)).toBe(true);
    expect(shouldFocusWorkspacePane("activation", false)).toBe(true);
  });
});
