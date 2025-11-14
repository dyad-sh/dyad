import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deployAllSupabaseFunctions } from "@/supabase_admin/supabase_utils";
import * as supabaseManagementClient from "@/supabase_admin/supabase_management_client";
import fs from "node:fs/promises";

// Mock the dependencies
vi.mock("@/supabase_admin/supabase_management_client", () => ({
  deploySupabaseFunctions: vi.fn(),
}));

vi.mock("node:fs/promises");

describe("deployAllSupabaseFunctions", () => {
  const mockAppPath = "/test/app/path";
  const mockProjectId = "test-project-id";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return empty array when supabase/functions directory does not exist", async () => {
    // Mock fs.access to throw (directory doesn't exist)
    vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));

    const errors = await deployAllSupabaseFunctions({
      appPath: mockAppPath,
      supabaseProjectId: mockProjectId,
    });

    expect(errors).toEqual([]);
    expect(fs.readdir).not.toHaveBeenCalled();
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).not.toHaveBeenCalled();
  });

  it("should return empty array when supabase/functions directory is empty", async () => {
    // Mock directory exists but is empty
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockResolvedValue([]);

    const errors = await deployAllSupabaseFunctions({
      appPath: mockAppPath,
      supabaseProjectId: mockProjectId,
    });

    expect(errors).toEqual([]);
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).not.toHaveBeenCalled();
  });

  it("should deploy a single function successfully", async () => {
    // Mock directory exists with one function
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "hello", isDirectory: () => true } as any,
    ]);
    vi.mocked(fs.readFile).mockResolvedValue("function content");
    vi.mocked(
      supabaseManagementClient.deploySupabaseFunctions,
    ).mockResolvedValue(undefined);

    const errors = await deployAllSupabaseFunctions({
      appPath: mockAppPath,
      supabaseProjectId: mockProjectId,
    });

    expect(errors).toEqual([]);
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledTimes(1);
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledWith({
      supabaseProjectId: mockProjectId,
      functionName: "hello",
      content: "function content",
    });
  });

  it("should deploy multiple functions successfully", async () => {
    // Mock directory exists with three functions
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "function1", isDirectory: () => true } as any,
      { name: "function2", isDirectory: () => true } as any,
      { name: "function3", isDirectory: () => true } as any,
    ]);
    vi.mocked(fs.readFile).mockResolvedValue("function content");
    vi.mocked(
      supabaseManagementClient.deploySupabaseFunctions,
    ).mockResolvedValue(undefined);

    const errors = await deployAllSupabaseFunctions({
      appPath: mockAppPath,
      supabaseProjectId: mockProjectId,
    });

    expect(errors).toEqual([]);
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledTimes(3);
  });

  it("should skip functions without index.ts file", async () => {
    // Mock directory with two functions, one missing index.ts
    vi.mocked(fs.access).mockImplementation((path: any) => {
      const pathStr = String(path);
      // First call: check if supabase/functions directory exists - should succeed
      if (pathStr.endsWith("supabase/functions")) {
        return Promise.resolve(undefined);
      }
      // Check for function1/index.ts - should succeed
      if (pathStr.includes("function1/index.ts")) {
        return Promise.resolve(undefined);
      }
      // function2 missing index.ts - should fail
      if (pathStr.includes("function2/index.ts")) {
        return Promise.reject(new Error("ENOENT"));
      }
      return Promise.reject(new Error("ENOENT"));
    });
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "function1", isDirectory: () => true } as any,
      { name: "function2", isDirectory: () => true } as any,
    ]);
    vi.mocked(fs.readFile).mockResolvedValue("function content");
    vi.mocked(
      supabaseManagementClient.deploySupabaseFunctions,
    ).mockResolvedValue(undefined);

    const errors = await deployAllSupabaseFunctions({
      appPath: mockAppPath,
      supabaseProjectId: mockProjectId,
    });

    expect(errors).toEqual([]);
    // Only function1 should be deployed
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledTimes(1);
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledWith({
      supabaseProjectId: mockProjectId,
      functionName: "function1",
      content: "function content",
    });
  });

  it("should collect errors when function deployment fails", async () => {
    // Mock directory with two functions, one fails to deploy
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "function1", isDirectory: () => true } as any,
      { name: "function2", isDirectory: () => true } as any,
    ]);
    vi.mocked(fs.readFile).mockResolvedValue("function content");
    vi.mocked(supabaseManagementClient.deploySupabaseFunctions)
      .mockResolvedValueOnce(undefined) // function1 succeeds
      .mockRejectedValueOnce(new Error("Deployment failed")); // function2 fails

    const errors = await deployAllSupabaseFunctions({
      appPath: mockAppPath,
      supabaseProjectId: mockProjectId,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Failed to deploy function2");
    expect(errors[0]).toContain("Deployment failed");
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledTimes(2);
  });

  it("should deploy functions in batches of 5", async () => {
    // Mock directory with 12 functions to test batching
    const functionNames = Array.from(
      { length: 12 },
      (_, i) => `function${i + 1}`,
    );
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockResolvedValue(
      functionNames.map((name) => ({
        name,
        isDirectory: () => true,
      })) as any,
    );
    vi.mocked(fs.readFile).mockResolvedValue("function content");
    vi.mocked(
      supabaseManagementClient.deploySupabaseFunctions,
    ).mockResolvedValue(undefined);

    const errors = await deployAllSupabaseFunctions({
      appPath: mockAppPath,
      supabaseProjectId: mockProjectId,
    });

    expect(errors).toEqual([]);
    // All 12 functions should be deployed
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledTimes(12);
  });

  it("should handle mixed success and failure in batch deployment", async () => {
    // Mock directory with 7 functions, some fail
    const functionNames = Array.from(
      { length: 7 },
      (_, i) => `function${i + 1}`,
    );
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockResolvedValue(
      functionNames.map((name) => ({
        name,
        isDirectory: () => true,
      })) as any,
    );
    vi.mocked(fs.readFile).mockResolvedValue("function content");

    // Make functions 2, 4, and 6 fail
    let _callCount = 0;
    vi.mocked(
      supabaseManagementClient.deploySupabaseFunctions,
    ).mockImplementation(async ({ functionName }) => {
      _callCount++;
      if (
        functionName === "function2" ||
        functionName === "function4" ||
        functionName === "function6"
      ) {
        throw new Error(`Failed to deploy ${functionName}`);
      }
      return undefined;
    });

    const errors = await deployAllSupabaseFunctions({
      appPath: mockAppPath,
      supabaseProjectId: mockProjectId,
    });

    expect(errors).toHaveLength(3);
    expect(errors).toEqual([
      expect.stringContaining("Failed to deploy function2"),
      expect.stringContaining("Failed to deploy function4"),
      expect.stringContaining("Failed to deploy function6"),
    ]);
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledTimes(7);
  });

  it("should skip non-directory entries", async () => {
    // Mock directory with mix of directories and files
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "function1", isDirectory: () => true } as any,
      { name: "README.md", isDirectory: () => false } as any,
      { name: "function2", isDirectory: () => true } as any,
      { name: ".gitignore", isDirectory: () => false } as any,
    ]);
    vi.mocked(fs.readFile).mockResolvedValue("function content");
    vi.mocked(
      supabaseManagementClient.deploySupabaseFunctions,
    ).mockResolvedValue(undefined);

    const errors = await deployAllSupabaseFunctions({
      appPath: mockAppPath,
      supabaseProjectId: mockProjectId,
    });

    expect(errors).toEqual([]);
    // Only directories should be processed
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledTimes(2);
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledWith({
      supabaseProjectId: mockProjectId,
      functionName: "function1",
      content: "function content",
    });
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledWith({
      supabaseProjectId: mockProjectId,
      functionName: "function2",
      content: "function content",
    });
  });

  it("should handle error reading functions directory", async () => {
    // Mock directory exists but reading fails
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockRejectedValue(new Error("Permission denied"));

    const errors = await deployAllSupabaseFunctions({
      appPath: mockAppPath,
      supabaseProjectId: mockProjectId,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Error reading functions directory");
    expect(errors[0]).toContain("Permission denied");
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).not.toHaveBeenCalled();
  });

  it("should read correct content for each function", async () => {
    // Mock directory with three functions with different content
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "hello", isDirectory: () => true } as any,
      { name: "goodbye", isDirectory: () => true } as any,
    ]);

    // Mock different content for each function
    vi.mocked(fs.readFile).mockImplementation((path: any) => {
      if (path.includes("hello")) {
        return Promise.resolve("hello content");
      }
      if (path.includes("goodbye")) {
        return Promise.resolve("goodbye content");
      }
      return Promise.reject(new Error("Unexpected path"));
    });

    vi.mocked(
      supabaseManagementClient.deploySupabaseFunctions,
    ).mockResolvedValue(undefined);

    const errors = await deployAllSupabaseFunctions({
      appPath: mockAppPath,
      supabaseProjectId: mockProjectId,
    });

    expect(errors).toEqual([]);
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledWith({
      supabaseProjectId: mockProjectId,
      functionName: "hello",
      content: "hello content",
    });
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledWith({
      supabaseProjectId: mockProjectId,
      functionName: "goodbye",
      content: "goodbye content",
    });
  });

  it("should handle file read errors for specific functions", async () => {
    // Mock directory with two functions, one fails to read
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "function1", isDirectory: () => true } as any,
      { name: "function2", isDirectory: () => true } as any,
    ]);

    // Mock readFile to fail for function2
    vi.mocked(fs.readFile).mockImplementation((path: any) => {
      if (path.includes("function1")) {
        return Promise.resolve("function1 content");
      }
      return Promise.reject(new Error("Read error"));
    });

    vi.mocked(
      supabaseManagementClient.deploySupabaseFunctions,
    ).mockResolvedValue(undefined);

    const errors = await deployAllSupabaseFunctions({
      appPath: mockAppPath,
      supabaseProjectId: mockProjectId,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Failed to deploy function2");
    expect(errors[0]).toContain("Read error");
    // function1 should still be deployed
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledTimes(1);
    expect(
      supabaseManagementClient.deploySupabaseFunctions,
    ).toHaveBeenCalledWith({
      supabaseProjectId: mockProjectId,
      functionName: "function1",
      content: "function1 content",
    });
  });
});
