import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AppChatContext } from "../lib/schemas";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

let mockSettings = {
  enableNativeGit: true,
  enableDyadPro: false,
  enableProSmartFilesContextMode: false,
};

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => mockSettings),
}));

import { extractCodebase } from "../utils/codebase";

const execFileAsync = promisify(execFile);
const EMPTY_CHAT_CONTEXT: AppChatContext = {
  contextPaths: [],
  smartContextAutoIncludes: [],
};

async function runGit(repoDir: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: repoDir });
}

async function createCapacitorLikeRepo(): Promise<string> {
  const repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dyad-"));

  await runGit(repoDir, ["init"]);

  await fs.promises.mkdir(path.join(repoDir, "src"), { recursive: true });
  await fs.promises.mkdir(
    path.join(repoDir, "android", "app", "src", "main", "java", "com", "app"),
    { recursive: true },
  );
  await fs.promises.mkdir(
    path.join(repoDir, "android", "app", "src", "main", "assets", "public"),
    { recursive: true },
  );
  await fs.promises.mkdir(
    path.join(repoDir, "ios", "App", "App", "public", "assets"),
    { recursive: true },
  );
  await fs.promises.mkdir(path.join(repoDir, "ios", "App", "App"), {
    recursive: true,
  });

  await fs.promises.writeFile(
    path.join(repoDir, "src", "main.ts"),
    "export const app = true;\n",
  );
  await fs.promises.writeFile(
    path.join(
      repoDir,
      "android",
      "app",
      "src",
      "main",
      "java",
      "com",
      "app",
      "MainActivity.java",
    ),
    "class MainActivity {}\n",
  );
  await fs.promises.writeFile(
    path.join(repoDir, "ios", "App", "App", "AppDelegate.swift"),
    "final class AppDelegate {}\n",
  );
  await fs.promises.writeFile(
    path.join(
      repoDir,
      "android",
      "app",
      "src",
      "main",
      "assets",
      "public",
      "bundle.js",
    ),
    "console.log('android bundle');\n",
  );
  await fs.promises.writeFile(
    path.join(repoDir, "ios", "App", "App", "public", "assets", "bundle.js"),
    "console.log('ios bundle');\n",
  );
  await fs.promises.writeFile(
    path.join(
      repoDir,
      "android",
      "app",
      "src",
      "main",
      "assets",
      "public",
      ".gitignore",
    ),
    "*\n!.gitignore\n",
  );
  await fs.promises.writeFile(
    path.join(repoDir, "ios", "App", "App", "public", ".gitignore"),
    "*\n!.gitignore\n",
  );

  return repoDir;
}

describe("extractCodebase", () => {
  let repoDir: string | undefined;

  afterEach(async () => {
    mockSettings = {
      enableNativeGit: true,
      enableDyadPro: false,
      enableProSmartFilesContextMode: false,
    };

    if (repoDir) {
      await fs.promises.rm(repoDir, { recursive: true, force: true });
      repoDir = undefined;
    }
  });

  it.each([true, false])(
    "skips generated Capacitor sync output when enableNativeGit=%s",
    async (enableNativeGit) => {
      repoDir = await createCapacitorLikeRepo();
      mockSettings = {
        ...mockSettings,
        enableNativeGit,
      };

      const { files } = await extractCodebase({
        appPath: repoDir,
        chatContext: EMPTY_CHAT_CONTEXT,
      });

      const filePaths = files.map((file) => file.path);

      expect(filePaths).toContain("src/main.ts");
      expect(filePaths).toContain(
        "android/app/src/main/java/com/app/MainActivity.java",
      );
      expect(filePaths).toContain("ios/App/App/AppDelegate.swift");
      expect(filePaths).not.toContain(
        "android/app/src/main/assets/public/bundle.js",
      );
      expect(filePaths).not.toContain("ios/App/App/public/assets/bundle.js");
      expect(
        filePaths.some((filePath) =>
          filePath.startsWith("android/app/src/main/assets/public/"),
        ),
      ).toBe(false);
      expect(
        filePaths.some((filePath) =>
          filePath.startsWith("ios/App/App/public/"),
        ),
      ).toBe(false);
    },
  );
});
