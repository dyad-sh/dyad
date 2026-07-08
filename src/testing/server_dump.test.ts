import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readServerDump } from "./server_dump";

describe("server dump normalization", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("masks Windows compaction backup paths before snapshotting", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-dump-test-"));
    const dumpPath = path.join(tempDir, "dump.json");
    fs.writeFileSync(
      dumpPath,
      JSON.stringify({
        body: {
          messages: [
            {
              role: "assistant",
              content:
                "Read backup at .dyad\\chats\\2\\compaction-2026-07-08T00-49-31-772Z.md",
            },
          ],
        },
      }),
    );

    const dump = readServerDump([dumpPath]);

    expect(dump.text).toContain("[[compaction-backup-path]]");
    expect(dump.text).not.toContain(".dyad\\chats\\2");
  });
});
