import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectFrameworkType } from "./framework_utils";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
}));

describe("detectFrameworkType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects Next.js from package.json when no config file exists", () => {
    vi.mocked(fs.existsSync).mockImplementation((candidate) =>
      String(candidate).endsWith("package.json"),
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        dependencies: {
          next: "^15.0.0",
        },
      }),
    );

    expect(detectFrameworkType("/tmp/example-app")).toBe("nextjs");
  });

  it("detects Vite from package.json when no config file exists", () => {
    vi.mocked(fs.existsSync).mockImplementation((candidate) =>
      String(candidate).endsWith("package.json"),
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        devDependencies: {
          vite: "^7.0.0",
        },
      }),
    );

    expect(detectFrameworkType("/tmp/example-app")).toBe("vite");
  });
});
