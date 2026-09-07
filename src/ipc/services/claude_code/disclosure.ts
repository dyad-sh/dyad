import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getUserDataPath } from "@/paths/paths";

const VERSION = "prototype-v1";
export async function hasClaudeDisclosure(): Promise<boolean> {
  try {
    return (
      (await readFile(
        path.join(getUserDataPath(), "claude-code-disclosure"),
        "utf8",
      )) === VERSION
    );
  } catch {
    return false;
  }
}
export async function acceptClaudeDisclosure(): Promise<void> {
  await mkdir(getUserDataPath(), { recursive: true });
  await writeFile(
    path.join(getUserDataPath(), "claude-code-disclosure"),
    VERSION,
    { mode: 0o600 },
  );
}
