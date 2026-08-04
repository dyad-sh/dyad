import { describe, expect, it } from "vitest";
import {
  APP_FRAMEWORK_TYPES,
  type AppFrameworkType,
} from "@/lib/framework_constants";
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

  it("runs a Vite app that gained a Nitro server, rather than serving files", () => {
    // Adding a Neon database turns a Vite app into this. It is a real server,
    // so it cannot be static — but it is still a Vite build, so nixpacks
    // cannot install it either.
    expect(buildConfigForFramework("vite-nitro")).toEqual({
      buildPack: "railpack",
      portsExposes: "3000",
      isStatic: false,
      isSpa: false,
      startCommand: "node .output/server/index.mjs",
    });
  });

  it("runs Next.js as a server on 3000", () => {
    expect(buildConfigForFramework("nextjs")).toEqual({
      buildPack: "nixpacks",
      portsExposes: "3000",
      isStatic: false,
      isSpa: false,
    });
  });

  it.each(["other", null] as const)(
    "treats %s as a server, which fails visibly rather than serving nothing",
    (framework) => {
      expect(buildConfigForFramework(framework).buildPack).toBe("nixpacks");
    },
  );

  // Driven off the constant rather than a hand-written list: a new framework
  // type then fails here until someone decides how Coolify should build it.
  // vite-nitro shipped broken because the old list asserted nixpacks for it.
  describe.each([...APP_FRAMEWORK_TYPES, null])(
    "every framework type (%s)",
    (framework: AppFrameworkType | null) => {
      const config = buildConfigForFramework(framework);

      it("produces a build pack the client can send", () => {
        expect(["railpack", "nixpacks"]).toContain(config.buildPack);
      });

      it("exposes exactly one port", () => {
        expect(config.portsExposes).toMatch(/^\d+$/);
      });

      it("serves static output from a publish directory, or runs a process", () => {
        // nginx needs somewhere to serve from; a server needs something to run.
        if (config.isStatic) {
          expect(config.publishDirectory).toBeTruthy();
          expect(config.startCommand).toBeUndefined();
        } else {
          expect(config.publishDirectory).toBeUndefined();
        }
      });

      it("only rewrites unknown paths when it is serving static files", () => {
        if (config.isSpa) expect(config.isStatic).toBe(true);
      });
    },
  );
});
