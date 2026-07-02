import { describe, expect, it } from "vitest";
import { sanitizePathEnv } from "./managed_tools";

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
});
