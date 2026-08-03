import type { AppFrameworkType } from "@/lib/framework_constants";
import type { CoolifyBuildConfig } from "@/ipc/utils/coolify_client";

/** Where each framework leaves its built output. */
const VITE_PUBLISH_DIRECTORY = "/dist";

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
 * An unknown framework is treated as a server, since a static site served as
 * one fails visibly while the reverse can look deployed but serve nothing.
 */
export function buildConfigForFramework(
  frameworkType: AppFrameworkType | null,
): CoolifyBuildConfig {
  if (frameworkType === "vite") {
    return {
      buildPack: "railpack",
      // nginx serves the built output, so the port is its own, not the app's.
      portsExposes: "80",
      isStatic: true,
      // React Router and friends need unknown paths rewritten to index.html.
      isSpa: true,
      publishDirectory: VITE_PUBLISH_DIRECTORY,
    };
  }
  return {
    buildPack: "nixpacks",
    portsExposes: "3000",
    isStatic: false,
    isSpa: false,
  };
}
