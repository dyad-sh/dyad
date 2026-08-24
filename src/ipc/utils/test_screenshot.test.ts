// @vitest-environment node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/paths/paths", () => ({ getUserDataPath: vi.fn() }));

import { getUserDataPath } from "@/paths/paths";
import { E2E_TEST_ARTIFACT_DIR } from "@/ipc/services/e2e_test_workspace";
import { readTestScreenshotDataUrl } from "./test_screenshot";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-screenshot-"));
  roots.push(root);
  return root;
}

// A 1x1 PNG. The reader sniffs the magic bytes before serving anything.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
  "hex",
);

describe("readTestScreenshotDataUrl", () => {
  it("serves a retained artifact whose root sits inside the app directory", async () => {
    // A portable or dev install can put `userData` inside the project, which
    // makes every retained artifact *also* look like an app path. Reading it as
    // one skips the app-id check and then compares the run directory name
    // against "test-results", so the thumbnail silently fails to load.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    const userData = path.join(appPath, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    const shot = path.join(
      userData,
      E2E_TEST_ARTIFACT_DIR,
      "7-abc123",
      "test-results",
      "spec-fails",
      "test-failed-1.png",
    );
    await fs.mkdir(path.dirname(shot), { recursive: true });
    await fs.writeFile(shot, PNG);

    await expect(readTestScreenshotDataUrl(appPath, shot, 7)).resolves.toMatch(
      /^data:image\/png;base64,/,
    );
  });

  it("refuses another app's retained artifacts", async () => {
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    const userData = path.join(root, "user-data");
    vi.mocked(getUserDataPath).mockReturnValue(userData);
    const shot = path.join(
      userData,
      E2E_TEST_ARTIFACT_DIR,
      "8-abc123",
      "test-results",
      "test-failed-1.png",
    );
    await fs.mkdir(path.dirname(shot), { recursive: true });
    await fs.writeFile(shot, PNG);
    await fs.mkdir(appPath, { recursive: true });

    await expect(
      readTestScreenshotDataUrl(appPath, shot, 7),
    ).resolves.toBeNull();
  });

  it("refuses a file outside the app's own test-results", async () => {
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    const shot = path.join(appPath, "src", "logo.png");
    await fs.mkdir(path.dirname(shot), { recursive: true });
    await fs.writeFile(shot, PNG);

    await expect(
      readTestScreenshotDataUrl(appPath, shot, 7),
    ).resolves.toBeNull();
  });
});
