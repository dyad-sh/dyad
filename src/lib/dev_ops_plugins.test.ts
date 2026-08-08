import { describe, expect, it } from "vitest";

import { hasEnabledDevOpsPlugins } from "./dev_ops_plugins";

describe("hasEnabledDevOpsPlugins", () => {
  it("only enables Dev Ops when GitHub or Vercel is connected", () => {
    expect(hasEnabledDevOpsPlugins(null)).toBe(false);
    expect(
      hasEnabledDevOpsPlugins({
        githubAccessToken: { value: "github-token" },
      }),
    ).toBe(true);
    expect(
      hasEnabledDevOpsPlugins({
        vercelAccessToken: { value: "vercel-token" },
      }),
    ).toBe(true);
  });
});
