import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import { isComponentTaggerUpgradeNeeded } from "../ipc/utils/app_upgrade_utils";

vi.mock("node:fs");

describe("isComponentTaggerUpgradeNeeded Heuristics", () => {
  const mockPath = "/mock/app";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return false if the project is not a Vite app (no config file)", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    expect(isComponentTaggerUpgradeNeeded(mockPath)).toBe(false);
  });

  it("should return true for a React Vite app needing upgrade", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(`
      import { defineConfig } from 'vite';
      import react from '@vitejs/plugin-react-swc';
      export default defineConfig({ plugins: [react()] });
    `);
    expect(isComponentTaggerUpgradeNeeded(mockPath)).toBe(true);
  });

  it("should return false for a Vue Vite app (React heuristic filter)", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(`
      import { defineConfig } from 'vite';
      import vue from '@vitejs/plugin-vue';
      export default defineConfig({ plugins: [vue()] });
    `);
    expect(isComponentTaggerUpgradeNeeded(mockPath)).toBe(false); // Correctly filtered out
  });

  it("should return false if the React Vite app already has the tagger applied", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(`
      import { defineConfig } from 'vite';
      import react from '@vitejs/plugin-react';
      import dyadComponentTagger from '@dyad-sh/react-vite-component-tagger';
      export default defineConfig({ plugins: [dyadComponentTagger(), react()] });
    `);
    expect(isComponentTaggerUpgradeNeeded(mockPath)).toBe(false);
  });
});
