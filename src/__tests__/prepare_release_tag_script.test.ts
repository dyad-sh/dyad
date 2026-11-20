// @vitest-environment node

import { createRequire } from "module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  assertReleaseCanMoveTag,
  findReleaseByTag,
  getRepoParts,
  getRemoteTagShaFromOutput,
  prepareReleaseTag,
  writeGithubOutputs,
} = require("../../scripts/prepare-release-tag.js");

describe("prepare release tag script", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["^45.3.2", "45.3.2", /Release blocked until the update service/, false],
    [">=40", "44.0.0", /Release blocked until the update service/, false],
    [
      "^40.0.0",
      undefined,
      /Cannot determine the locked Electron version/,
      false,
    ],
    ["^40.0.0", "40.0.0", /already published/, true],
  ])(
    "checks Electron %s resolved to %s before preparing the release tag",
    async (electronSpecifier, lockedVersion, expectedError, reachesGitHub) => {
      const directory = mkdtempSync(path.join(tmpdir(), "dyad-release-tag-"));
      try {
        const packageJsonPath = path.join(directory, "package.json");
        writeFileSync(
          packageJsonPath,
          JSON.stringify({
            version: "1.3.0",
            devDependencies: { electron: electronSpecifier },
          }),
        );
        writeFileSync(
          path.join(directory, "package-lock.json"),
          JSON.stringify({
            packages: { "node_modules/electron": { version: lockedVersion } },
          }),
        );
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ draft: false }),
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(
          prepareReleaseTag({
            currentSha: "commit-sha",
            owner: "dyad-sh",
            packageJsonPath,
            repo: "dyad",
            token: "token",
          }),
        ).rejects.toThrow(expectedError);
        expect(fetchMock).toHaveBeenCalledTimes(reachesGitHub ? 1 : 0);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("allows missing or draft releases to move a tag", () => {
    expect(() =>
      assertReleaseCanMoveTag({ release: null, tagName: "v1.3.0" }),
    ).not.toThrow();
    expect(() =>
      assertReleaseCanMoveTag({
        release: { draft: true },
        tagName: "v1.3.0",
      }),
    ).not.toThrow();
  });

  it("refuses to move a tag for a published release", () => {
    expect(() =>
      assertReleaseCanMoveTag({
        release: { draft: false },
        tagName: "v1.3.0",
      }),
    ).toThrow("Release v1.3.0 is already published");
  });

  it("parses GitHub repository coordinates", () => {
    expect(getRepoParts("dyad-sh/dyad")).toEqual({
      owner: "dyad-sh",
      repo: "dyad",
    });
  });

  it("fetches published releases by tag before falling back to listed drafts", async () => {
    const release = { draft: false, tag_name: "v1.3.0" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => release,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      findReleaseByTag({
        owner: "dyad-sh",
        repo: "dyad",
        tagName: "v1.3.0",
        token: "token",
      }),
    ).resolves.toBe(release);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain("/releases/tags/v1.3.0");
  });

  it("falls back to listed releases when direct tag lookup returns 404", async () => {
    const draftRelease = { draft: true, tag_name: "v1.3.0" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "not found",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [draftRelease],
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      findReleaseByTag({
        owner: "dyad-sh",
        repo: "dyad",
        tagName: "v1.3.0",
        token: "token",
      }),
    ).resolves.toBe(draftRelease);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain(
      "/releases?per_page=100&page=1",
    );
  });

  it("keeps non-404 GitHub API errors from direct tag lookup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
        text: async () => "server error",
      }),
    );

    await expect(
      findReleaseByTag({
        owner: "dyad-sh",
        repo: "dyad",
        tagName: "v1.3.0",
        token: "token",
      }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("prefers dereferenced SHAs for annotated remote tags", () => {
    expect(
      getRemoteTagShaFromOutput({
        output: [
          "tag-object-sha\trefs/tags/v1.3.0",
          "commit-sha\trefs/tags/v1.3.0^{}",
        ].join("\n"),
        tagName: "v1.3.0",
      }),
    ).toBe("commit-sha");
  });

  it("falls back to the tag SHA for lightweight remote tags", () => {
    expect(
      getRemoteTagShaFromOutput({
        output: "commit-sha\trefs/tags/v1.3.0",
        tagName: "v1.3.0",
      }),
    ).toBe("commit-sha");
  });

  it("rejects multiline GitHub output values", () => {
    expect(() =>
      writeGithubOutputs({
        outputPath: "unused",
        outputs: { tag: "v1.3.0\nmalformed=true" },
      }),
    ).toThrow("GitHub output values must not contain newlines: tag");
  });
});
