import {
  NITRO_START_COMMAND,
  type AppFrameworkType,
} from "@/lib/framework_constants";
import type { CoolifyBuildConfig } from "@/ipc/utils/coolify_client";

/**
 * What the app says about itself, read from its own files.
 *
 * The build pack works out how to install, build and run an app on its own,
 * and it reads the app rather than a table, so it is right about apps nobody
 * here has heard of. Anything it can determine is better left to it.
 */
interface AppDeclarations {
  /**
   * Whether the app names its own entry point — a `start` script, a `main`
   * field, or a root index module. These are what the build pack looks for,
   * in that order.
   */
  declaresStart: boolean;
}

/** An app that says nothing about itself, which is the safe assumption. */
const NO_DECLARATIONS: AppDeclarations = { declaresStart: false };

/**
 * The part of a build configuration Dyad supplies.
 *
 * One field, because there is one thing left worth saying. Anything Dyad adds
 * here is a claim that overrides what the build pack would have decided, and
 * is worth making only where Dyad knows something the build pack cannot read
 * off the app.
 */
interface FrameworkKnowledge {
  /**
   * Used only when the app declares no entry point of its own. An app that
   * names one is describing something Dyad cannot see — a changed Nitro
   * output directory, a wrapper script — and overriding it would break a
   * configuration that was already correct.
   */
  fallbackStartCommand?: string;
}

/**
 * The port Coolify routes to.
 *
 * Coolify will not route to an application that exposes none — it warns that
 * the app "will not be reachable through the proxy or your domains" — so one
 * is always sent. The value is arbitrary: Coolify passes it as $PORT, and
 * both railpack's Caddy and any framework's server bind what they are given.
 *
 * It is a container port, so every app can use the same one. Host ports are
 * Coolify's separate port mappings, which Dyad does not set.
 */
const DEFAULT_PORT = "3000";

/**
 * What Dyad knows about each framework, over and above what the build pack
 * works out for itself.
 *
 * Partial on purpose: a framework belongs here only when there is something
 * to say about it. Railpack detects Vite, Astro, Next.js, CRA, Angular,
 * React Router and Expo Web on its own, reads the app rather than a table,
 * and so is right about apps nobody here has heard of — including ones added
 * after this was written. Absent means "let railpack decide", which is the
 * answer for everything not listed.
 */
const FRAMEWORK_KNOWLEDGE: Partial<
  Record<AppFrameworkType, FrameworkKnowledge>
> = {
  /**
   * Adding a database turns a Vite app into this: a real server, but one that
   * keeps the `vite.config.ts` railpack reads as a static site. Naming an
   * entry point is what stops it being served as one, with its API routes
   * answering nothing.
   *
   * Only used when the app names no entry point of its own — the conversion
   * writes a `start` script, so this is for apps converted before it did.
   */
  "vite-nitro": { fallbackStartCommand: NITRO_START_COMMAND },
};

/**
 * Decides how Coolify should build and serve an app.
 *
 * Railpack rather than nixpacks throughout: nixpacks is in maintenance mode,
 * and it cannot install these apps anyway — left to itself it silently skips
 * the bundler's native binding, and given a pinned package manager it shims
 * it through a corepack too old to run it.
 */
export function buildConfigForFramework(
  frameworkType: AppFrameworkType | null,
  declarations: AppDeclarations = NO_DECLARATIONS,
): CoolifyBuildConfig {
  const known = (frameworkType && FRAMEWORK_KNOWLEDGE[frameworkType]) ?? {};

  return {
    buildPack: "railpack",
    portsExposes: DEFAULT_PORT,
    // Absent where Dyad has never supplied one, so a value the user set in
    // Coolify survives a redeploy. Where it has — an app converted before the
    // conversion started writing a `start` script — the stored command is now
    // stale, and Coolify prefers its own over the app's, so it is cleared
    // rather than left: only then does the script the app carries take effect.
    startCommand:
      known.fallbackStartCommand === undefined
        ? undefined
        : declarations.declaresStart
          ? ""
          : known.fallbackStartCommand,
  };
}
