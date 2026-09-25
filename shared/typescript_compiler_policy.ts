/**
 * Which TypeScript compiler API a host-side analysis worker may load.
 *
 * - `local-or-bundled`: prefer the app's own `node_modules/typescript`, and
 *   fall back to Dyad's bundled compiler when its API is incompatible.
 * - `bundled-only`: load only Dyad's bundled compiler. The app's TypeScript
 *   package is app-controlled code, so Docker runtime mode must never
 *   `require()` it on the host.
 */
export type TypeScriptCompilerPolicy = "local-or-bundled" | "bundled-only";
