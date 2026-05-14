import { describe, expect, it } from "vitest";

import addAuthenticationGuide from "./guides/add-authentication.md?raw";
import addEmailVerificationGuide from "./guides/add-email-verification.md?raw";
import addPasswordResetGuide from "./guides/add-password-reset.md?raw";
import { filterGuideByFramework } from "./guides/filter_guide_by_framework";
import { getNeonAvailableSystemPrompt } from "./neon_prompt";
import {
  APP_FRAMEWORK_TYPES,
  type AppFrameworkType,
} from "@/lib/framework_constants";

// Stand-in for the real Neon client code that the caller injects. Using a
// constant placeholder keeps snapshots stable and focused on the prompt
// scaffolding rather than the client snippet.
const NEON_CLIENT_CODE = "// <neon-client-code>";

describe("getNeonAvailableSystemPrompt", () => {
  describe("nextjs", () => {
    it("default options", () => {
      expect(
        getNeonAvailableSystemPrompt(NEON_CLIENT_CODE, "nextjs"),
      ).toMatchSnapshot();
    });

    it("with email verification on Next.js 16+", () => {
      expect(
        getNeonAvailableSystemPrompt(NEON_CLIENT_CODE, "nextjs", {
          emailVerificationEnabled: true,
          nextjsMajorVersion: 16,
        }),
      ).toMatchSnapshot();
    });

    it("on Next.js 15 (no proxy.ts support)", () => {
      expect(
        getNeonAvailableSystemPrompt(NEON_CLIENT_CODE, "nextjs", {
          nextjsMajorVersion: 15,
        }),
      ).toMatchSnapshot();
    });

    it("local agent mode with email verification", () => {
      expect(
        getNeonAvailableSystemPrompt(NEON_CLIENT_CODE, "nextjs", {
          emailVerificationEnabled: true,
          isLocalAgentMode: true,
        }),
      ).toMatchSnapshot();
    });
  });

  describe("vite-nitro", () => {
    it("default options", () => {
      expect(
        getNeonAvailableSystemPrompt(NEON_CLIENT_CODE, "vite-nitro"),
      ).toMatchSnapshot();
    });

    it("with email verification", () => {
      expect(
        getNeonAvailableSystemPrompt(NEON_CLIENT_CODE, "vite-nitro", {
          emailVerificationEnabled: true,
        }),
      ).toMatchSnapshot();
    });

    it("local agent mode", () => {
      expect(
        getNeonAvailableSystemPrompt(NEON_CLIENT_CODE, "vite-nitro", {
          isLocalAgentMode: true,
        }),
      ).toMatchSnapshot();
    });
  });

  it("plain vite falls back to the generic framework path", () => {
    expect(
      getNeonAvailableSystemPrompt(NEON_CLIENT_CODE, "vite"),
    ).toMatchSnapshot();
  });

  it("unknown framework (null) uses the generic path and keeps both guide sections", () => {
    expect(
      getNeonAvailableSystemPrompt(NEON_CLIENT_CODE, null),
    ).toMatchSnapshot();
  });

  // Smoke test: each guide file ships both the <nextjs-only> and
  // <vite-nitro-only> blocks that filterGuideByFramework requires. If anyone
  // edits a guide and drops a block, the filter throws — and this test
  // catches it before the prompt build does.
  describe("guide files satisfy the framework-filter contract", () => {
    const guides = {
      "add-authentication": addAuthenticationGuide,
      "add-email-verification": addEmailVerificationGuide,
      "add-password-reset": addPasswordResetGuide,
    };
    const frameworks: (AppFrameworkType | null)[] = [
      ...APP_FRAMEWORK_TYPES,
      null,
    ];

    for (const [name, body] of Object.entries(guides)) {
      for (const framework of frameworks) {
        it(`${name} renders for framework=${framework ?? "null"}`, () => {
          expect(() => filterGuideByFramework(body, framework)).not.toThrow();
        });
      }
    }
  });
});
