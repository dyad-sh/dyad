import { beforeEach, describe, expect, it, vi } from "vitest";

import addAuthenticationGuide from "../prompts/guides/add-authentication.md?raw";
import { filterGuideByFramework } from "../prompts/guides/filter_guide_by_framework";

const getCachedEmailPasswordConfig = vi.fn();
const getNeonContext = vi.fn();

vi.mock("./neon_management_client", () => ({
  getCachedEmailPasswordConfig,
}));

vi.mock("./neon_context", async () => {
  const actual =
    await vi.importActual<typeof import("./neon_context")>("./neon_context");

  return {
    ...actual,
    getNeonContext,
  };
});

describe("buildNeonPromptAdditions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("includes Neon project context for non-local-agent prompts", async () => {
    getCachedEmailPasswordConfig.mockResolvedValue({
      require_email_verification: true,
    });
    getNeonContext.mockResolvedValue("# Neon Project Info");

    const { buildNeonPromptAdditions } = await import("./neon_prompt_context");

    const additions = await buildNeonPromptAdditions({
      projectId: "project-123",
      branchId: "branch-123",
      frameworkType: "nextjs",
      includeContext: true,
      isLocalAgentMode: false,
    });

    expect(additions).toContain("<neon-system-prompt>");
    expect(additions).toContain("# Neon Project Info");
    expect(additions).toContain(
      filterGuideByFramework(addAuthenticationGuide, "nextjs"),
    );
    // Closing tags are never mentioned inline in the prose, so they're a
    // reliable signal that the tag was stripped.
    expect(additions).not.toContain("</vite-nitro-only>");
    expect(additions).not.toContain("</nextjs-only>");
    expect(additions).not.toContain("Path: Neon Auth (Vite + Nitro)");
    expect(additions).not.toContain('guide="add-authentication"');
    expect(getCachedEmailPasswordConfig).toHaveBeenCalledWith(
      "project-123",
      "branch-123",
    );
    expect(getNeonContext).toHaveBeenCalledWith({
      projectId: "project-123",
      branchId: "branch-123",
    });
  });

  it("uses read_guide instructions when isLocalAgentMode is true", async () => {
    getCachedEmailPasswordConfig.mockResolvedValue({
      require_email_verification: false,
    });
    getNeonContext.mockResolvedValue("# Neon Project Info");

    const { buildNeonPromptAdditions } = await import("./neon_prompt_context");

    const additions = await buildNeonPromptAdditions({
      projectId: "project-123",
      branchId: "branch-123",
      frameworkType: "nextjs",
      includeContext: true,
      isLocalAgentMode: true,
    });

    expect(additions).toContain("<neon-system-prompt>");
    expect(additions).toContain('guide="add-authentication"');
    expect(additions).not.toContain(addAuthenticationGuide);
  });

  it("strips the Vite + Nitro section from the auth guide when frameworkType is nextjs", async () => {
    getCachedEmailPasswordConfig.mockResolvedValue({
      require_email_verification: false,
    });
    getNeonContext.mockResolvedValue("# Neon Project Info");

    const { buildNeonPromptAdditions } = await import("./neon_prompt_context");

    const additions = await buildNeonPromptAdditions({
      projectId: "project-123",
      branchId: "branch-123",
      frameworkType: "nextjs",
      includeContext: true,
      isLocalAgentMode: false,
    });

    expect(additions).toContain("Path: Neon Auth API (Next.js)");
    expect(additions).not.toContain("Path: Neon Auth (Vite + Nitro)");
    expect(additions).not.toContain("</vite-nitro-only>");
    expect(additions).not.toContain("</nextjs-only>");
  });

  it("strips the Next.js section from the auth guide when frameworkType is vite-nitro", async () => {
    getCachedEmailPasswordConfig.mockResolvedValue({
      require_email_verification: false,
    });
    getNeonContext.mockResolvedValue("# Neon Project Info");

    const { buildNeonPromptAdditions } = await import("./neon_prompt_context");

    const additions = await buildNeonPromptAdditions({
      projectId: "project-123",
      branchId: "branch-123",
      frameworkType: "vite-nitro",
      includeContext: true,
      isLocalAgentMode: false,
    });

    expect(additions).toContain("Path: Neon Auth (Vite + Nitro)");
    expect(additions).not.toContain("Path: Neon Auth API (Next.js)");
    expect(additions).not.toContain("</nextjs-only>");
    expect(additions).not.toContain("</vite-nitro-only>");
  });

  it("emits Vite + Nitro instructions when frameworkType is vite-nitro", async () => {
    getCachedEmailPasswordConfig.mockResolvedValue({
      require_email_verification: false,
    });
    getNeonContext.mockResolvedValue("# Neon Project Info");

    const { buildNeonPromptAdditions } = await import("./neon_prompt_context");

    const additions = await buildNeonPromptAdditions({
      projectId: "project-123",
      branchId: "branch-123",
      frameworkType: "vite-nitro",
      includeContext: true,
      isLocalAgentMode: false,
    });

    expect(additions).toContain("<vite-nitro-instructions>");
    expect(additions).toContain("server/routes/api/");
    expect(additions).toContain("server/utils/db.ts");
    expect(additions).toContain("NEON_AUTH_BASE_URL");
    expect(additions).not.toContain("<nextjs-instructions>");
  });

  it("skips branch-specific fetches when no branch is available", async () => {
    const { buildNeonPromptAdditions } = await import("./neon_prompt_context");

    const additions = await buildNeonPromptAdditions({
      projectId: "project-123",
      branchId: null,
      frameworkType: "vite",
      includeContext: true,
      isLocalAgentMode: false,
    });

    expect(additions).toContain("<neon-system-prompt>");
    expect(getCachedEmailPasswordConfig).not.toHaveBeenCalled();
    expect(getNeonContext).not.toHaveBeenCalled();
  });
});
