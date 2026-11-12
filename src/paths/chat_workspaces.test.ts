import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getChatWorkspacesRoot,
  isInsideChatWorkspace,
} from "./chat_workspaces";

describe("isInsideChatWorkspace", () => {
  it("recognizes folders inside Dyad's chat worktrees", () => {
    const root = getChatWorkspacesRoot();
    expect(isInsideChatWorkspace(path.join(root, "app-1", "chat-2-abc"))).toBe(
      true,
    );
    expect(
      isInsideChatWorkspace(path.join(root, "app-1", "chat-2-abc", "web")),
    ).toBe(true);
  });

  it("leaves the root itself and every other folder alone", () => {
    const root = getChatWorkspacesRoot();
    expect(isInsideChatWorkspace(root)).toBe(false);
    expect(isInsideChatWorkspace(path.join(root, "..", "dyad-apps", "x"))).toBe(
      false,
    );
    expect(isInsideChatWorkspace(`${root}-elsewhere`)).toBe(false);
  });
});
