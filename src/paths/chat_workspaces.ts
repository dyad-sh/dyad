import path from "node:path";
import { getUserDataPath } from "./paths";

/** Dyad-owned root for chat worktrees; never inside an app directory. */
export function getChatWorkspacesRoot(): string {
  return path.join(getUserDataPath(), "chat-workspaces");
}

/** Whether a path is inside one of Dyad's chat worktrees. */
export function isInsideChatWorkspace(candidate: string): boolean {
  const relative = path.relative(
    getChatWorkspacesRoot(),
    path.resolve(candidate),
  );
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}
