import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ipc } from "@/ipc/types";
import {
  MAX_VERSION_CHANGED_FILES,
  MAX_VERSION_DIFF_CONTENT_BYTES,
} from "@/ipc/types/version";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

function git(appDir: string, args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test User", ...args],
    { cwd: appDir },
  )
    .toString()
    .trim();
}

describe("version diff memory limits (integration)", () => {
  let harness: HybridChatHarness;
  let commitHash: string;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      settings: { isTestMode: true },
    });

    await fs.promises.writeFile(
      path.join(harness.appDir, "000-large.txt"),
      "x".repeat(MAX_VERSION_DIFF_CONTENT_BYTES + 1),
    );
    await fs.promises.writeFile(
      path.join(harness.appDir, "001-normal.txt"),
      "normal diff content\n",
    );
    const manyDir = path.join(harness.appDir, "many");
    await fs.promises.mkdir(manyDir, { recursive: true });
    await Promise.all(
      Array.from({ length: MAX_VERSION_CHANGED_FILES + 2 }, (_, index) =>
        fs.promises.writeFile(
          path.join(manyDir, `file-${String(index).padStart(4, "0")}.txt`),
          `${index}\n`,
        ),
      ),
    );
    git(harness.appDir, ["add", "-A"]);
    git(harness.appDir, ["commit", "-m", "large version diff"]);
    commitHash = git(harness.appDir, ["rev-parse", "HEAD"]);
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("returns bounded metadata and preflights selected blob content", async () => {
    const metadata = await ipc.version.getVersionChanges({
      appId: harness.appId,
      versionId: commitHash,
    });

    expect(metadata.files).toHaveLength(MAX_VERSION_CHANGED_FILES);
    expect(metadata.truncated).toBe(true);
    expect(metadata.files[0]).toEqual({
      path: "000-large.txt",
      type: "added",
    });

    const large = await ipc.version.getVersionFileChange({
      appId: harness.appId,
      versionId: commitHash,
      filePath: "000-large.txt",
    });
    expect(large.newContentStatus).toBe("too-large");
    expect(large.newContent).toBe("<file too large to display>");

    const normal = await ipc.version.getVersionFileChange({
      appId: harness.appId,
      versionId: commitHash,
      filePath: "001-normal.txt",
    });
    expect(normal.newContentStatus).toBe("available");
    expect(normal.newContent).toBe("normal diff content\n");
  });
});
