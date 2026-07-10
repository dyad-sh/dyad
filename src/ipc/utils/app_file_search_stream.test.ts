import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  default: { spawn: mocks.spawn },
  spawn: mocks.spawn,
}));
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({ debug: vi.fn(), warn: vi.fn() }),
  },
}));
vi.mock("./ripgrep_utils", () => ({
  getRgExecutablePath: () => "rg",
  MAX_FILE_SEARCH_SIZE: 1024 * 1024,
  RIPGREP_EXCLUDED_GLOBS: ["!node_modules/**", "!.git/**", "!.next/**"],
}));

import {
  MAX_APP_FILE_SEARCH_FILES,
  searchAppFilesWithRipgrep,
} from "./app_file_search";

class FakeRipgrepProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => true);
}

function matchEvent(path: string, lineText: string, query: string) {
  const start = Buffer.byteLength(lineText.slice(0, lineText.indexOf(query)));
  return JSON.stringify({
    type: "match",
    data: {
      path: { text: path },
      lines: { text: `${lineText}\n` },
      line_number: 1,
      submatches: [
        {
          match: { text: query },
          start,
          end: start + Buffer.byteLength(query),
        },
      ],
    },
  });
}

describe("searchAppFilesWithRipgrep stream handling", () => {
  let child: FakeRipgrepProcess;

  beforeEach(() => {
    child = new FakeRipgrepProcess();
    mocks.spawn.mockReset();
    mocks.spawn.mockReturnValue(child);
  });

  it("preserves UTF-8 characters split across stdout chunks", async () => {
    const search = searchAppFilesWithRipgrep({
      appPath: "/tmp/test-app",
      query: "needle",
    });
    const encoded = Buffer.from(
      `${matchEvent("unicode.txt", "😀needle界", "needle")}\n`,
    );
    const emojiOffset = encoded.indexOf(Buffer.from("😀"));

    child.stdout.emit("data", encoded.subarray(0, emojiOffset + 2));
    child.stdout.emit("data", encoded.subarray(emojiOffset + 2));
    child.emit("close", 0);

    const [result] = await search;
    const snippet = result.snippets?.[0];
    expect(`${snippet?.before}${snippet?.match}${snippet?.after}`).toContain(
      "😀needle界",
    );
    expect(JSON.stringify(result)).not.toContain("�");
  });

  it("ignores a process error emitted after an intentional early kill", async () => {
    const search = searchAppFilesWithRipgrep({
      appPath: "/tmp/test-app",
      query: "needle",
    });
    const output = Array.from(
      { length: MAX_APP_FILE_SEARCH_FILES + 1 },
      (_, index) => matchEvent(`file-${index}.txt`, "needle", "needle"),
    ).join("\n");

    child.stdout.emit("data", Buffer.from(`${output}\n`));
    expect(child.kill).toHaveBeenCalledOnce();
    child.emit("error", new Error("kill race"));
    child.emit("close", null);

    const results = await search;
    expect(results).toHaveLength(MAX_APP_FILE_SEARCH_FILES);
    expect(results.every((result) => result.truncated)).toBe(true);
  });

  it("keeps legal names beginning with two dots while rejecting traversal", async () => {
    const search = searchAppFilesWithRipgrep({
      appPath: "/tmp/test-app",
      query: "needle",
    });

    child.stdout.emit(
      "data",
      Buffer.from(
        `${matchEvent("..config", "needle", "needle")}\n${matchEvent("../outside.txt", "needle", "needle")}\n`,
      ),
    );
    child.emit("close", 0);

    await expect(search).resolves.toEqual([
      expect.objectContaining({ path: "..config" }),
    ]);
  });
});
