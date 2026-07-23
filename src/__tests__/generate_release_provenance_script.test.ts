// @vitest-environment node

import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  collectReleaseArtifacts,
  createReleaseProvenance,
} = require("../../scripts/generate-release-provenance.js");

const temporaryDirectories: string[] = [];

function createTemporaryDirectory() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "dyad-release-provenance-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("release provenance generator", () => {
  it("hashes and sorts only published release artifact types", () => {
    const directory = createTemporaryDirectory();
    fs.mkdirSync(path.join(directory, "nested"));
    fs.writeFileSync(path.join(directory, "nested", "dyad.zip"), "zip");
    fs.writeFileSync(path.join(directory, "RELEASES"), "manifest");
    fs.writeFileSync(path.join(directory, "ignored.json"), "{}");

    expect(collectReleaseArtifacts(directory)).toEqual([
      {
        name: "RELEASES",
        sha256:
          "05b3abf2579a5eb66403cd78be557fd860633a1fe2103c7642030defe32c657f",
        size: 8,
      },
      {
        name: "dyad.zip",
        sha256:
          "4a70fe9aa6436e02c2dea340fbd1e352e4ef2d8ce6ca52ad25d4b95471fc8bf2",
        size: 3,
      },
    ]);
  });

  it("binds artifacts to the repository, workflow, ref, and commit", () => {
    const directory = createTemporaryDirectory();
    fs.writeFileSync(path.join(directory, "dyad.exe"), "binary");

    const provenance = createReleaseProvenance({
      outputDirectory: directory,
      platform: "windows",
      environment: {
        GITHUB_REF: "refs/heads/main",
        GITHUB_REPOSITORY: "dyad-sh/dyad",
        GITHUB_REPOSITORY_ID: "964395174",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_RUN_ID: "12345",
        GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
        RELEASE_TAG: "v1.8.0",
        RELEASE_VERSION: "1.8.0",
      },
    });

    expect(provenance).toMatchObject({
      schemaVersion: 1,
      repository: { id: "964395174", name: "dyad", owner: "dyad-sh" },
      source: {
        commit: "0123456789abcdef0123456789abcdef01234567",
        ref: "refs/heads/main",
        runAttempt: "1",
        runId: "12345",
        workflow: ".github/workflows/release.yml",
      },
      release: { platform: "windows", tag: "v1.8.0", version: "1.8.0" },
    });
  });

  it("rejects a tag that does not match the package version", () => {
    const directory = createTemporaryDirectory();
    fs.writeFileSync(path.join(directory, "dyad.exe"), "binary");

    expect(() =>
      createReleaseProvenance({
        outputDirectory: directory,
        platform: "windows",
        environment: {
          GITHUB_REF: "refs/heads/main",
          GITHUB_REPOSITORY: "dyad-sh/dyad",
          GITHUB_REPOSITORY_ID: "964395174",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_RUN_ID: "12345",
          GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
          RELEASE_TAG: "v9.9.9",
          RELEASE_VERSION: "1.8.0",
        },
      }),
    ).toThrow("does not match version");
  });
});
