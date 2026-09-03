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

  it("refuses a .png that isn't one", async () => {
    // The extension is attacker-chosen — the path comes back from a Playwright
    // report. Without the magic-byte check the reader would happily wrap any
    // file it can reach under `test-results/` in an `image/png` data URL and
    // hand it to the renderer.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    const userData = path.join(root, "user-data");
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
    await fs.mkdir(appPath, { recursive: true });
    await fs.writeFile(shot, Buffer.from("DATABASE_URL=postgres://real\n"));

    // The same path with real PNG bytes is served, so only the sniff can be
    // what rejects this one.
    await expect(
      readTestScreenshotDataUrl(appPath, shot, 7),
    ).resolves.toBeNull();
    await fs.writeFile(shot, PNG);
    await expect(readTestScreenshotDataUrl(appPath, shot, 7)).resolves.toMatch(
      /^data:image\/png;base64,/,
    );
  });

  // Symlink creation needs elevation on Windows, so the escape cases only run
  // where an attacker could actually create one.
  const symlinkIt = process.platform === "win32" ? it.skip : it;

  symlinkIt("serves the app's own test-results directory", async () => {
    // Every other success case goes through the retained-artifact root; this is
    // the in-app branch of the containment check.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    const shot = path.join(appPath, "test-results", "a", "test-failed-1.png");
    await fs.mkdir(path.dirname(shot), { recursive: true });
    await fs.writeFile(shot, PNG);

    await expect(readTestScreenshotDataUrl(appPath, shot, 7)).resolves.toMatch(
      /^data:image\/png;base64,/,
    );
  });

  symlinkIt("refuses a .png symlinked out of the app", async () => {
    // The containment check runs on the REAL path for exactly this: a link
    // inside `test-results/` that resolves to the user's secrets would
    // otherwise pass a string-only check while the read escaped.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    const secret = path.join(root, "outside", ".env.local");
    await fs.mkdir(path.dirname(secret), { recursive: true });
    await fs.writeFile(secret, "DATABASE_URL=postgres://real\n");
    const shot = path.join(appPath, "test-results", "a", "test-failed-1.png");
    await fs.mkdir(path.dirname(shot), { recursive: true });
    await fs.symlink(secret, shot, "file");

    await expect(
      readTestScreenshotDataUrl(appPath, shot, 7),
    ).resolves.toBeNull();
  });

  symlinkIt("refuses a .png symlinked outside test-results", async () => {
    // Inside the app, so the containment check passes — the `test-results`
    // segment check on the resolved path is what has to reject this.
    const root = await tempRoot();
    const appPath = path.join(root, "app");
    vi.mocked(getUserDataPath).mockReturnValue(path.join(root, "user-data"));
    const secret = path.join(appPath, "src", "secrets.png");
    await fs.mkdir(path.dirname(secret), { recursive: true });
    await fs.writeFile(secret, PNG);
    const shot = path.join(appPath, "test-results", "a", "test-failed-1.png");
    await fs.mkdir(path.dirname(shot), { recursive: true });
    await fs.symlink(secret, shot, "file");

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
