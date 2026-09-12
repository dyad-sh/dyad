import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { readTestScreenshotDataUrl } from "@/ipc/utils/test_screenshot";

// These tests model the TOCTOU window between readTestScreenshotDataUrl's
// realpath/containment check and its open(). The filesystem is mutated from
// inside a spy on `fs.promises.realpath` so the pre-open check still sees an
// in-bounds path while `open()` re-resolves against the mutated tree. They
// need real symlinks, so skip on Windows where creating a symlink needs
// elevated privileges.
describe.runIf(process.platform !== "win32")(
  "readTestScreenshotDataUrl TOCTOU containment",
  () => {
    let tmp: string;
    let appPath: string;
    let attackerTree: string;
    let originalRealpath: typeof fs.promises.realpath;

    const IN_APP_PAYLOAD = "IN-APP SCREENSHOT PAYLOAD";
    const ATTACKER_PAYLOAD = "ATTACKER PAYLOAD FROM OUTSIDE APP DIR";
    const SCREENSHOT_NAME = "test-failed-1.png";
    const SCREENSHOT_REL = path.join("test-results", "spec", SCREENSHOT_NAME);

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shot-toctou-"));
      appPath = path.join(tmp, "app");
      attackerTree = path.join(tmp, "attacker");
      fs.mkdirSync(path.join(appPath, "test-results", "spec"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(appPath, SCREENSHOT_REL), IN_APP_PAYLOAD);
      fs.mkdirSync(path.join(attackerTree, "spec"), { recursive: true });
      fs.writeFileSync(
        path.join(attackerTree, "spec", SCREENSHOT_NAME),
        ATTACKER_PAYLOAD,
      );
      originalRealpath = fs.promises.realpath.bind(fs.promises);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    // Mutate the live filesystem at the moment realpath(resolved) completes,
    // so the pre-open containment check sees an in-bounds path while open()
    // re-resolves against the mutated tree. The swap fires only for the
    // screenshot path (the function also realpaths appPath, which is the app
    // root and unaffected by mutating its `test-results/` child).
    function swapDuringResolvedRealpath(shot: string, swap: () => void) {
      vi.spyOn(fs.promises, "realpath").mockImplementation((async (
        p: string,
      ) => {
        const result = await originalRealpath(p);
        if (p === shot) swap();
        return result;
      }) as typeof fs.promises.realpath);
    }

    it("reads an in-bounds screenshot on the happy path", async () => {
      const shot = path.join(appPath, SCREENSHOT_REL);
      const url = await readTestScreenshotDataUrl(appPath, shot);
      if (url === null) throw new Error("expected a data url");
      expect(url.startsWith("data:image/png;base64,")).toBe(true);
      const bytes = Buffer.from(
        url.slice("data:image/png;base64,".length),
        "base64",
      );
      // The post-open re-validation (Linux /proc/self/fd, elsewhere a realpath
      // re-check) must not reject the benign in-bounds read.
      expect(bytes.toString("utf8")).toBe(IN_APP_PAYLOAD);
    });

    it("refuses a path that already resolves outside the app dir", async () => {
      const url = await readTestScreenshotDataUrl(
        appPath,
        path.join(attackerTree, "spec", SCREENSHOT_NAME),
      );
      expect(url).toBeNull();
    });

    it("blocks a trailing-component symlink swap via O_NOFOLLOW", async () => {
      const shot = path.join(appPath, SCREENSHOT_REL);
      swapDuringResolvedRealpath(shot, () => {
        // Replace the file itself with a symlink to the attacker file; the
        // trailing-component O_NOFOLLOW guard must reject it (ELOOP -> null).
        fs.rmSync(shot);
        fs.symlinkSync(path.join(attackerTree, "spec", SCREENSHOT_NAME), shot);
      });
      await expect(
        readTestScreenshotDataUrl(appPath, shot),
      ).resolves.toBeNull();
    });

    it("blocks an ancestor-directory symlink swap after open", async () => {
      const shot = path.join(appPath, SCREENSHOT_REL);
      swapDuringResolvedRealpath(shot, () => {
        // Replace the `test-results/` ancestor with a symlink to the attacker
        // tree. O_NOFOLLOW does not reject this (only the trailing component is
        // checked), so open() follows the symlink; the post-open re-validation
        // must catch the escape and return null instead of the attacker bytes.
        fs.rmSync(path.join(appPath, "test-results"), {
          recursive: true,
          force: true,
        });
        fs.symlinkSync(attackerTree, path.join(appPath, "test-results"), "dir");
      });
      await expect(
        readTestScreenshotDataUrl(appPath, shot),
      ).resolves.toBeNull();
    });

    it("does not regress: in-bounds file opened via a clean in-app symlink", async () => {
      // An in-bounds ancestor symlink that resolves inside `test-results/`
      // must still be served (the post-open re-validation follows it to an
      // in-app path, which passes containment).
      const aliasDir = path.join(appPath, "alias-link");
      fs.symlinkSync(path.join(appPath, "test-results"), aliasDir, "dir");
      const viaAlias = path.join(
        appPath,
        "alias-link",
        "spec",
        SCREENSHOT_NAME,
      );
      const url = await readTestScreenshotDataUrl(appPath, viaAlias);
      if (url === null) throw new Error("expected a data url");
      const bytes = Buffer.from(
        url.slice("data:image/png;base64,".length),
        "base64",
      );
      expect(bytes.toString("utf8")).toBe(IN_APP_PAYLOAD);
    });
  },
);
