import { describe, expect, it } from "vitest";
import { buildConfigForFramework } from "./coolify_build_config";

describe("buildConfigForFramework", () => {
  it("builds a plain Vite app with railpack, then serves the output", () => {
    // Not the `static` build pack: that skips the build and copies the repo
    // as-is, serving unbuilt source that the browser rejects. And not
    // nixpacks, which cannot install a modern pnpm project.
    expect(buildConfigForFramework("vite")).toEqual({
      buildPack: "railpack",
      portsExposes: "80",
      isStatic: true,
      isSpa: true,
      publishDirectory: "/dist",
    });
  });

  it.each(["nextjs", "vite-nitro"] as const)(
    "runs %s as a server on 3000 rather than serving files",
    (framework) => {
      expect(buildConfigForFramework(framework)).toEqual({
        buildPack: "nixpacks",
        portsExposes: "3000",
        isStatic: false,
        isSpa: false,
      });
    },
  );

  it.each(["other", null] as const)(
    "treats %s as a server, which fails visibly rather than serving nothing",
    (framework) => {
      expect(buildConfigForFramework(framework).buildPack).toBe("nixpacks");
    },
  );
});
