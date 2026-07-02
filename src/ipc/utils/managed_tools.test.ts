import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSanitizedPathCache, sanitizePathEnv } from "./managed_tools";

async function withPlatform<T>(
  platform: NodeJS.Platform,
  callback: () => Promise<T> | T,
): Promise<T> {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });

  try {
    return await callback();
  } finally {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  }
}

describe("sanitizePathEnv", () => {
  beforeEach(() => {
    clearSanitizedPathCache();
  });

  afterEach(() => {
    clearSanitizedPathCache();
  });

  it("does not reuse a Windows env-var cache entry when a referenced var changes from missing to empty", async () => {
    await withPlatform("win32", () => {
      const envVarName = `DYAD_SANITIZE_PATH_TEST_${Date.now()}`;
      const pathValue = `%${envVarName}%/__dyad_missing_path_segment__`;

      expect(sanitizePathEnv({ PATH: pathValue }).PATH).toBe(pathValue);
      expect(sanitizePathEnv({ PATH: pathValue, [envVarName]: "" }).PATH).toBe(
        "",
      );
    });
  });

  it("can clear a missing-directory verdict when an install creates that directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-path-cache-"));
    const binDir = path.join(tempDir, "managed-bin");

    try {
      expect(sanitizePathEnv({ PATH: binDir }).PATH).toBe("");
      fs.mkdirSync(binDir);
      expect(sanitizePathEnv({ PATH: binDir }).PATH).toBe("");

      clearSanitizedPathCache();

      expect(sanitizePathEnv({ PATH: binDir }).PATH).toBe(binDir);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
