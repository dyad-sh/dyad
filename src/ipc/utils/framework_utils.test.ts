import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectFrameworkType,
  detectNextJsMajorVersion,
} from "./framework_utils";

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

  it("detects Next.js from next.config.cjs", () => {
    vi.mocked(fs.existsSync).mockImplementation((candidate) =>
      String(candidate).endsWith("next.config.cjs"),
    );

    expect(detectFrameworkType("/tmp/example-app")).toBe("nextjs");
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

describe("detectNextJsMajorVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the major version from a caret range", () => {
    vi.mocked(fs.existsSync).mockImplementation((candidate) =>
      String(candidate).endsWith("package.json"),
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ dependencies: { next: "^15.1.2" } }),
    );

    expect(detectNextJsMajorVersion("/tmp/example-app")).toBe(15);
  });

  it("returns the major version from an exact version", () => {
    vi.mocked(fs.existsSync).mockImplementation((candidate) =>
      String(candidate).endsWith("package.json"),
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ devDependencies: { next: "16.0.0" } }),
    );

    expect(detectNextJsMajorVersion("/tmp/example-app")).toBe(16);
  });

  it("returns null when next is missing", () => {
    vi.mocked(fs.existsSync).mockImplementation((candidate) =>
      String(candidate).endsWith("package.json"),
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ dependencies: {} }),
    );

    expect(detectNextJsMajorVersion("/tmp/example-app")).toBeNull();
  });

  it("returns null for non-numeric versions like 'latest'", () => {
    vi.mocked(fs.existsSync).mockImplementation((candidate) =>
      String(candidate).endsWith("package.json"),
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ dependencies: { next: "latest" } }),
    );

    expect(detectNextJsMajorVersion("/tmp/example-app")).toBeNull();
  });

  it("returns null when package.json does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(detectNextJsMajorVersion("/tmp/example-app")).toBeNull();
  });
});
