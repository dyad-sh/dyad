import { beforeEach, describe, expect, it, vi } from "vitest";

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
    });

    expect(additions).toContain("<neon-system-prompt>");
    expect(additions).toContain("# Neon Project Info");
    expect(getCachedEmailPasswordConfig).toHaveBeenCalledWith(
      "project-123",
      "branch-123",
    );
    expect(getNeonContext).toHaveBeenCalledWith({
      projectId: "project-123",
      branchId: "branch-123",
      frameworkType: "nextjs",
    });
  });

  it("skips branch-specific fetches when no branch is available", async () => {
    const { buildNeonPromptAdditions } = await import("./neon_prompt_context");

    const additions = await buildNeonPromptAdditions({
      projectId: "project-123",
      branchId: null,
      frameworkType: "vite",
      includeContext: true,
    });

    expect(additions).toContain("<neon-system-prompt>");
    expect(getCachedEmailPasswordConfig).not.toHaveBeenCalled();
    expect(getNeonContext).not.toHaveBeenCalled();
  });
});
