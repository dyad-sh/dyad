import { describe, it, expect } from "vitest";
import { resolveDirectoryWithinAppPath } from "@/pro/main/ipc/handlers/local_agent/tools/path_safety";

describe("resolveDirectoryWithinAppPath", () => {
  it("allows valid subdirectories even if appPath uses forward slashes (Windows)", () => {
    const relativePathFromApp = resolveDirectoryWithinAppPath({
      appPath: "C:/Users/project",
      directory: "src",
    });

    expect(relativePathFromApp).toBe("src");
  });

  it("rejects any '..' segment (Windows)", () => {
    expect(() =>
      resolveDirectoryWithinAppPath({
        appPath: "C:/Users/project",
        directory: "src\\..\\src",
      }),
    ).toThrow(/contains "\.\." path traversal segment/);
  });

  it("rejects traversal outside appPath (Windows)", () => {
    expect(() =>
      resolveDirectoryWithinAppPath({
        appPath: "C:/Users/project",
        directory: "..\\..\\Windows",
      }),
    ).toThrow(/contains "\.\." path traversal segment/);
  });

  it("rejects absolute paths outside appPath (Windows)", () => {
    expect(() =>
      resolveDirectoryWithinAppPath({
        appPath: "C:/Users/project",
        directory: "C:\\Windows",
      }),
    ).toThrow(/escapes the project directory/);
  });

  it("allows valid subdirectories on POSIX paths", () => {
    const relativePathFromApp = resolveDirectoryWithinAppPath({
      appPath: "/Users/project",
      directory: "src",
    });

    expect(relativePathFromApp).toBe("src");
  });

  it("rejects any '..' segment (POSIX)", () => {
    expect(() =>
      resolveDirectoryWithinAppPath({
        appPath: "/Users/project",
        directory: "src/../src",
      }),
    ).toThrow(/contains "\.\." path traversal segment/);
  });

  it("rejects traversal outside appPath on POSIX paths", () => {
    expect(() =>
      resolveDirectoryWithinAppPath({
        appPath: "/Users/project",
        directory: "../../etc",
      }),
    ).toThrow(/contains "\.\." path traversal segment/);
  });

  it("rejects absolute paths outside appPath on POSIX paths", () => {
    expect(() =>
      resolveDirectoryWithinAppPath({
        appPath: "/Users/project",
        directory: "/etc",
      }),
    ).toThrow(/escapes the project directory/);
  });

  it("allows absolute paths inside appPath on POSIX paths", () => {
    const relativePathFromApp = resolveDirectoryWithinAppPath({
      appPath: "/Users/project",
      directory: "/Users/project/src",
    });

    expect(relativePathFromApp).toBe("src");
  });
});
