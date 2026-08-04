import type { AppFrameworkType } from "@/lib/framework_constants";
import type { CoolifyBuildConfig } from "@/ipc/utils/coolify_client";

/** Where each framework leaves its built output. */
const VITE_PUBLISH_DIRECTORY = "/dist";

/**
 * Nitro's node-server preset writes its entry here and listens on 3000.
 *
 * Nothing runs it on its own: the scaffold has no `start` script, and its
 * `preview` script is `vite preview`, which serves static assets and would
 * answer none of the server routes.
 */
const NITRO_START_COMMAND = "node .output/server/index.mjs";

/**
 * Decides how Coolify should build and serve an app.
 *
 * A plain Vite app compiles to static files with no process to run, so a
 * build pack alone finds nothing to start and the container exits. Pairing
 * one with `isStatic` builds it and then serves the output with nginx.
 *
 * Note this is not Coolify's `static` build pack: that one skips the build
 * entirely and copies the repository as-is, which serves the unbuilt source
 * and leaves the browser refusing `main.tsx` as the wrong MIME type.
 *
 * Railpack rather than nixpacks because nixpacks cannot install these apps.
 * Left to itself it silently skips the bundler's native binding, and given a
 * pinned package manager it shims it through a corepack too old to run it.
 * Railpack is its successor from the same authors and handles both.
 *
 * Adding a Neon database turns a Vite app into a `vite-nitro` one, which is
 * both at once: a real server, so it cannot be static, and still a Vite build,
 * so nixpacks cannot install it either. It gets railpack and an explicit start
 * command.
 *
 * An unknown framework is treated as a server, since a static site served as
 * one fails visibly while the reverse can look deployed but serve nothing.
 */
export function buildConfigForFramework(
  frameworkType: AppFrameworkType | null,
): CoolifyBuildConfig {
  switch (frameworkType) {
    case "vite":
      return {
        buildPack: "railpack",
        // nginx serves the built output, so the port is its own, not the app's.
        portsExposes: "80",
        isStatic: true,
        // React Router and friends need unknown paths rewritten to index.html.
        isSpa: true,
        publishDirectory: VITE_PUBLISH_DIRECTORY,
      };
    case "vite-nitro":
      return {
        buildPack: "railpack",
        portsExposes: "3000",
        // Nitro serves the built client itself, from inside the same process.
        isStatic: false,
        isSpa: false,
        startCommand: NITRO_START_COMMAND,
      };
    case "nextjs":
    case "other":
    case null:
      return {
        buildPack: "nixpacks",
        portsExposes: "3000",
        isStatic: false,
        isSpa: false,
      };
    default: {
      // A new AppFrameworkType must make a decision here rather than silently
      // inheriting the server default — that is how vite-nitro shipped broken.
      const exhaustive: never = frameworkType;
      void exhaustive;
      return {
        buildPack: "nixpacks",
        portsExposes: "3000",
        isStatic: false,
        isSpa: false,
      };
    }
  }
}
