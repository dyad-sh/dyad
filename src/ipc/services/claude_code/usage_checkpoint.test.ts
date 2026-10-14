// @vitest-environment node
import { expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  claudeUsageDelta,
  ClaudeSessionManifestSchema,
  writeClaudeSessionManifest,
} from "./usage_checkpoint";

const first = {
  opus: {
    inputTokens: 6,
    outputTokens: 1219,
    cacheReadInputTokens: 52274,
    cacheCreationInputTokens: 37567,
  },
};
const second = {
  opus: {
    inputTokens: 10,
    outputTokens: 3011,
    cacheReadInputTokens: 128366,
    cacheCreationInputTokens: 42281,
  },
};
it("subtracts the captured resumed-turn counters in every category", () => {
  expect(claudeUsageDelta({ modelUsage: second }, first)).toEqual({
    baseline: second,
    result: {
      usage: undefined,
      modelUsage: {
        opus: {
          inputTokens: 4,
          outputTokens: 1792,
          cacheReadInputTokens: 76092,
          cacheCreationInputTokens: 4714,
        },
      },
    },
  });
});
it("keeps independent baselines for switched and auxiliary models", () => {
  const switched = { ...first, sonnet: second.opus };
  expect(
    claudeUsageDelta({ modelUsage: switched }, first).result.modelUsage,
  ).toEqual({
    opus: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    sonnet: second.opus,
  });
  expect(claudeUsageDelta({ modelUsage: first }, {}).result.modelUsage).toEqual(
    first,
  );
});
it("rejects regressing counters and lost models instead of charging history", () => {
  expect(() => claudeUsageDelta({ modelUsage: first }, second)).toThrow();
  expect(() => claudeUsageDelta({ modelUsage: {} }, first)).toThrow();
});
it("persists the baseline for a restarted adapter using an atomic manifest", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "claude-usage-test-"));
  const manifestPath = path.join(directory, "session.json");
  try {
    await writeClaudeSessionManifest(manifestPath, {
      sessionId: "session",
      fingerprint: "fingerprint",
      usageBaseline: first,
    });
    const restored = ClaudeSessionManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
    expect(
      claudeUsageDelta({ modelUsage: second }, restored.usageBaseline!).result
        .modelUsage.opus.outputTokens,
    ).toBe(1792);
    expect(await readdir(directory)).toEqual(["session.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
