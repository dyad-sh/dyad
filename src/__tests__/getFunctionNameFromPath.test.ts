import { getFunctionNameFromPath } from "@/ipc/processors/response_processor";
import { describe, expect, it } from "vitest";

describe("getFunctionNameFromPath", () => {
  it("returns directory name for index files", () => {
    expect(getFunctionNameFromPath("/foo/bar/index.ts")).toBe("bar");
  });

  it("returns directory name when given a directory path", () => {
    expect(getFunctionNameFromPath("/foo/bar")).toBe("bar");
  });
});
