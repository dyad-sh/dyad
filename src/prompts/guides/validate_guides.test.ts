import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const GUIDES_DIR = join(__dirname);

describe("prompt guide files", () => {
  // Guide files must have a top-level heading (## Title)
  // and balanced framework tags (<nextjs-only>...</nextjs-only>,
  // <vite-nitro-only>...</vite-nitro-only>)

  it("all guide files have a top-level heading", async () => {
    const files = await readdir(GUIDES_DIR);
    const mdFiles = files.filter(
      (f) => f.endsWith(".md") && f !== "filter_guide_by_framework.md",
    );

    expect(mdFiles.length).toBeGreaterThan(0);

    for (const file of mdFiles) {
      const content = await readFile(join(GUIDES_DIR, file), "utf-8");
      expect(content.trim().length, `${file} should not be empty`).toBeGreaterThan(0);
      expect(
        content.trimStart().startsWith("## "),
        `${file} should start with a top-level heading (## Title)`,
      ).toBe(true);
    }
  });

  it("all guide files have balanced nextjs-only tags", async () => {
    const files = await readdir(GUIDES_DIR);
    const mdFiles = files.filter(
      (f) => f.endsWith(".md") && f !== "filter_guide_by_framework.md",
    );

    for (const file of mdFiles) {
      const content = await readFile(join(GUIDES_DIR, file), "utf-8");
      const openNextjs = (content.match(/<nextjs-only>/g) ?? []).length;
      const closeNextjs = (content.match(/<\/nextjs-only>/g) ?? []).length;
      expect(closeNextjs, `${file}: </nextjs-only> closing tags`).toBe(0);
      expect(openNextjs, `${file}: <nextjs-only> open tags`).toBe(closeNextjs);
    }
  });

  it("all guide files have balanced vite-nitro-only tags", async () => {
    const files = await readdir(GUIDES_DIR);
    const mdFiles = files.filter(
      (f) => f.endsWith(".md") && f !== "filter_guide_by_framework.md",
    );

    for (const file of mdFiles) {
      const content = await readFile(join(GUIDES_DIR, file), "utf-8");
      const openVite = (content.match(/<vite-nitro-only>/g) ?? []).length;
      const closeVite = (content.match(/<\/vite-nitro-only>/g) ?? []).length;
      expect(closeVite, `${file}: </vite-nitro-only> closing tags`).toBe(0);
      expect(openVite, `${file}: <vite-nitro-only> open tags`).toBe(closeVite);
    }
  });
});