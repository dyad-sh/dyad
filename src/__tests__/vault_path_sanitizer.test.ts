import { describe, it, expect } from "vitest";
import {
  sanitizeProjectName,
  generateStoragePath,
  extractProjectNameFromPath,
  isValidBackupId,
  isValidStoragePath,
} from "../vault/vault_path_sanitizer";

describe("sanitizeProjectName", () => {
  it("should convert to lowercase", () => {
    expect(sanitizeProjectName("MyProject")).toBe("myproject");
  });

  it("should replace spaces with hyphens", () => {
    expect(sanitizeProjectName("My Project Name")).toBe("my-project-name");
  });

  it("should replace special characters with hyphens", () => {
    expect(sanitizeProjectName("my@project!name#123")).toBe(
      "my-project-name-123"
    );
  });

  it("should collapse multiple hyphens", () => {
    expect(sanitizeProjectName("my---project")).toBe("my-project");
  });

  it("should trim leading and trailing hyphens", () => {
    expect(sanitizeProjectName("-my-project-")).toBe("my-project");
  });

  it("should limit length to 50 characters", () => {
    const longName = "a".repeat(100);
    expect(sanitizeProjectName(longName).length).toBe(50);
  });

  it("should handle empty string", () => {
    expect(sanitizeProjectName("")).toBe("unnamed-project");
  });

  it("should handle null/undefined", () => {
    expect(sanitizeProjectName(null as any)).toBe("unnamed-project");
    expect(sanitizeProjectName(undefined as any)).toBe("unnamed-project");
  });

  it("should preserve underscores", () => {
    expect(sanitizeProjectName("my_project_name")).toBe("my_project_name");
  });

  it("should handle names that become empty after sanitization", () => {
    expect(sanitizeProjectName("@#$%")).toBe("unnamed-project");
  });
});

describe("generateStoragePath", () => {
  it("should generate correct path format", () => {
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const projectName = "My Project";
    const timestamp = 1700000000000;

    const path = generateStoragePath(userId, projectName, timestamp);
    expect(path).toBe(
      "550e8400-e29b-41d4-a716-446655440000/1700000000000-my-project.zip"
    );
  });

  it("should use current timestamp if not provided", () => {
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const projectName = "test";

    const path = generateStoragePath(userId, projectName);
    expect(path).toMatch(
      /^550e8400-e29b-41d4-a716-446655440000\/\d+-test\.zip$/
    );
  });
});

describe("extractProjectNameFromPath", () => {
  it("should extract project name from valid path", () => {
    const path =
      "550e8400-e29b-41d4-a716-446655440000/1700000000000-my-project.zip";
    expect(extractProjectNameFromPath(path)).toBe("my-project");
  });

  it("should return null for invalid path", () => {
    expect(extractProjectNameFromPath("invalid-path")).toBeNull();
    expect(extractProjectNameFromPath("")).toBeNull();
  });
});

describe("isValidBackupId", () => {
  it("should accept valid UUID v4", () => {
    expect(isValidBackupId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("should reject invalid UUIDs", () => {
    expect(isValidBackupId("not-a-uuid")).toBe(false);
    expect(isValidBackupId("")).toBe(false);
    expect(isValidBackupId(null as any)).toBe(false);
  });
});

describe("isValidStoragePath", () => {
  it("should accept valid storage path", () => {
    expect(
      isValidStoragePath(
        "550e8400-e29b-41d4-a716-446655440000/1700000000000-my-project.zip"
      )
    ).toBe(true);
  });

  it("should reject invalid paths", () => {
    expect(isValidStoragePath("invalid-path")).toBe(false);
    expect(isValidStoragePath("")).toBe(false);
    expect(isValidStoragePath(null as any)).toBe(false);
  });
});
