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
      startCommand: undefined,
    });
  });

  it("names the entry point of a Vite app that gained a Nitro server", () => {
    // Still a Vite build, so railpack reads its config as a static site.
    // Naming what to run is what stops it being served as one.
    expect(buildConfigForFramework("vite-nitro")).toEqual({
      buildPack: "railpack",
      portsExposes: "3000",
      startCommand: "node .output/server/index.mjs",
    });
  });

  it("defers to the app when it names its own entry point", () => {
    // Empty, not absent. Coolify keeps a start command once given one and
    // prefers it over the app's own script, so an app converted before it
    // wrote a `start` script would go on running the value an earlier deploy
    // left behind. Sending "" is what hands priority back to the app.
    expect(
      buildConfigForFramework("vite-nitro", { declaresStart: true })
        .startCommand,
    ).toBe("");
  });

  it("leaves a start command alone for a framework Dyad never sets one for", () => {
    // Next.js carries `next start`, so Dyad has never supplied a command for
    // it — and a value the user set in Coolify is theirs, not a stale one of
    // ours to clear.
    expect(
      buildConfigForFramework("nextjs", { declaresStart: true }).startCommand,
    ).toBeUndefined();
  });

  it("says nothing at all about Next.js", () => {
    // Railpack detects it and every scaffold carries `next start`.
    expect(buildConfigForFramework("nextjs")).toEqual({
      buildPack: "railpack",
      portsExposes: "3000",
      startCommand: undefined,
    });
  });

  it.each(["other", null] as const)(
    "leaves %s entirely to railpack",
    (framework) => {
      expect(buildConfigForFramework(framework).buildPack).toBe("railpack");
    },
  );

  // Driven off the constant rather than a hand-written list: a new framework
  // type then fails here until someone decides how Coolify should build it.
  describe.each([...APP_FRAMEWORK_TYPES, null])(
    "every framework type (%s)",
    (framework: AppFrameworkType | null) => {
      const config = buildConfigForFramework(framework);

      it("builds with railpack", () => {
        expect(config.buildPack).toBe("railpack");
      });

      it("always names a port", () => {
        // Coolify will not route to an application that exposes none.
        expect(config.portsExposes).toMatch(/^\d+$/);
      });

      it("claims nothing beyond the build pack, the port, and a start command", () => {
        // Everything else is the build pack's to decide, and a field Dyad
        // does not send is one Coolify keeps as already configured.
        expect(Object.keys(config).sort()).toEqual([
          "buildPack",
          "portsExposes",
          "startCommand",
        ]);
      });
    },
  );
});
