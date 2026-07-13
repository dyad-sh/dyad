// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import { getRegisteredHandlerForTesting } from "@/ipc/handlers/base";
import { registerVersionHandlers } from "@/ipc/handlers/version_handlers";
import {
  MAX_VERSION_CHANGED_FILES,
  MAX_VERSION_DIFF_CONTENT_BYTES,
  versionContracts,
} from "@/ipc/types/version";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

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
  let harness: ChatFlowHarness;
  let commitHash: string;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      enableNativeGit: false,
      registerChatStreamHandlers: false,
      useFakeCatalog: false,
    });
    registerVersionHandlers();

    await fs.promises.writeFile(
      path.join(harness.appDir, "001-normal.txt"),
      "content before the version\n",
    );
    git(harness.appDir, ["add", "-A"]);
    git(harness.appDir, ["commit", "-m", "version diff baseline"]);

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
    const getVersionChanges = getRegisteredHandlerForTesting(
      versionContracts.getVersionChanges.channel,
    );
    const getVersionFileChange = getRegisteredHandlerForTesting(
      versionContracts.getVersionFileChange.channel,
    );
    const metadata = (await getVersionChanges({} as never, {
      appId: harness.appId,
      versionId: commitHash,
    })) as { files: Array<{ path: string; type: string }>; truncated: boolean };

    expect(metadata.files).toHaveLength(MAX_VERSION_CHANGED_FILES);
    expect(metadata.truncated).toBe(true);
    expect(metadata.files[0]).toEqual({
      path: "000-large.txt",
      type: "added",
    });

    const large = (await getVersionFileChange({} as never, {
      appId: harness.appId,
      versionId: commitHash,
      filePath: "000-large.txt",
    })) as {
      newContentStatus: string;
      newContent: string;
    };
    expect(large.newContentStatus).toBe("too-large");
    expect(large.newContent).toBe("<file too large to display>");

    const normal = (await getVersionFileChange({} as never, {
      appId: harness.appId,
      versionId: commitHash,
      filePath: "001-normal.txt",
    })) as {
      oldContentStatus: string;
      oldContent: string;
      newContentStatus: string;
      newContent: string;
    };
    expect(normal.newContentStatus).toBe("available");
    expect(normal.newContent).toBe("normal diff content\n");
    expect(normal.oldContentStatus).toBe("available");
    expect(normal.oldContent).toBe("content before the version\n");
  });
});
