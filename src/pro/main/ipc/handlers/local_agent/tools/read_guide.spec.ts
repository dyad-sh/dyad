import { describe, expect, it, vi } from "vitest";
import { readSettings } from "@/main/settings";
import type { UserSettings } from "@/lib/schemas";
import type { AgentContext } from "./types";
import { readGuideTool } from "./read_guide";

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(),
}));

describe("readGuideTool", () => {
  it.each([true, false, undefined])(
    "uses the preview domains setting (%s) for authentication guidance",
    async (enableAppPreviewDomains) => {
      vi.mocked(readSettings).mockReturnValue({
        enableAppPreviewDomains,
      } as UserSettings);

      const guide = await readGuideTool.execute(
        { guide: "add-authentication" },
        { frameworkType: "vite-nitro" } as AgentContext,
      );

      expect(guide.includes("app-<numeric app ID>.localhost")).toBe(
        enableAppPreviewDomains === true,
      );
      expect(guide.includes("shared cookies across ports")).toBe(
        enableAppPreviewDomains !== true,
      );
      expect(guide).not.toContain("[[PREVIEW_COOKIE_GUIDANCE]]");
      expect(guide).not.toContain("Path: Neon Auth API (Next.js)");
      expect(guide).toContain("MUST be discarded unconditionally");
      expect(guide).toContain("forward at most the first occurrence");
    },
  );

  it("omits Nitro preview guidance for Next.js", async () => {
    vi.mocked(readSettings).mockReturnValue({
      enableAppPreviewDomains: true,
    } as UserSettings);

    const guide = await readGuideTool.execute({ guide: "add-authentication" }, {
      frameworkType: "nextjs",
    } as AgentContext);

    expect(guide).toContain("Path: Neon Auth API (Next.js)");
    expect(guide).not.toContain("Path: Neon Auth (Vite + Nitro)");
    expect(guide).not.toContain("app-<numeric app ID>.localhost");
    expect(guide).not.toContain("[[PREVIEW_COOKIE_GUIDANCE]]");
  });
});
