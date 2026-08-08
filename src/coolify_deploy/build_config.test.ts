import { describe, expect, it } from "vitest";
import {
  APP_FRAMEWORK_TYPES,
  type AppFrameworkType,
} from "@/lib/framework_constants";
import { buildConfigForFramework } from "./build_config";

describe("buildConfigForFramework", () => {
  it("leaves a plain Vite app entirely to railpack", () => {
    // Railpack recognises Vite, builds it and serves the output with Caddy,
    // so nothing is claimed about it at all.
    expect(buildConfigForFramework("vite")).toEqual({
      buildPack: "railpack",
      portsExposes: "3000",
      // Undefined rather than false: a field Dyad has no opinion on is not
      // sent, so Coolify keeps whatever is configured there.
      isStatic: undefined,
      isSpa: undefined,
      publishDirectory: undefined,
      startCommand: undefined,
    });
  });

  it("names the entry point of a Vite app that gained a Nitro server", () => {
    // Still a Vite build, so railpack reads its config as a static site.
    // Naming what to run is what stops it being served as one.
    expect(buildConfigForFramework("vite-nitro")).toEqual({
      buildPack: "railpack",
      portsExposes: "3000",
      isStatic: undefined,
      isSpa: undefined,
      publishDirectory: undefined,
      startCommand: "node .output/server/index.mjs",
    });
  });

  it("defers to the app when it names its own entry point", () => {
    // The Nitro conversion writes a start script now. Sending a command over
    // the top of it would override an app that knows its own build better —
    // a moved Nitro output directory, a wrapper script.
    expect(
      buildConfigForFramework("vite-nitro", { declaresStart: true })
        .startCommand,
    ).toBeUndefined();
  });

  it("says nothing at all about Next.js", () => {
    // Railpack detects it and every scaffold carries `next start`.
    expect(buildConfigForFramework("nextjs")).toEqual({
      buildPack: "railpack",
      portsExposes: "3000",
      isStatic: undefined,
      isSpa: undefined,
      publishDirectory: undefined,
      startCommand: undefined,
    });
  });

  it.each(["other", null] as const)(
    "treats %s as a server, which fails visibly rather than serving nothing",
    (framework) => {
      expect(buildConfigForFramework(framework).buildPack).toBe("railpack");
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

      it("always names a port", () => {
        // Coolify will not route to an application that exposes none.
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
