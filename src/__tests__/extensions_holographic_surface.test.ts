import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (...segments: string[]) =>
  fs.readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");

describe("Extensions holographic surface", () => {
  it("keeps settings-backed System destinations on the holographic canvas", () => {
    const source = readSource("pages", "system.tsx");

    expect(source).toContain('"settings-jarvis home-jarvis bg-background"');
    expect(source).toContain('<ParticleBackground className="z-0" />');
  });

  it("does not wrap the extensions directory in a background card", () => {
    const source = readSource(
      "components",
      "settings",
      "SettingsTabbedContent.tsx",
    );
    const extensionsRoot = source.match(
      /<div id=\{SECTION_IDS\.plugins\}[^>]*>/,
    )?.[0];

    expect(extensionsRoot).toBeDefined();
    expect(extensionsRoot).toContain('className="scroll-mt-24"');
    expect(extensionsRoot).not.toContain("settingsCardClass");
  });
});
