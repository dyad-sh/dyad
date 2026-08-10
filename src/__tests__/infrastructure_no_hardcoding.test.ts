import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The central principle, enforced.
 *
 * The infrastructure defines the dashboard; the dashboard must not define the
 * infrastructure. That is easy to agree with and easy to erode: one `if
 * (name === "ollama")` in a component, and the monitor quietly stops working
 * for anything nobody thought of.
 *
 * So the rule is a test. Product names may appear in exactly one file, the
 * identifier plugins, and nowhere else in the pipeline or the UI.
 */

const ROOT = path.resolve(__dirname, "../..");

/**
 * Names that must not appear outside the plugin file.
 *
 * The list is examples of the class, not an allow-list of what is supported:
 * the point is that the monitor works for services nobody has listed anywhere.
 */
const PRODUCT_NAMES = [
  "ollama",
  "qdrant",
  "whisper",
  "piper",
  "postgres",
  "redis",
  "mongodb",
  "elasticsearch",
  "rabbitmq",
  "kafka",
];

/** Everything in the pipeline except the one file allowed to know names. */
const GUARDED_FILES = [
  "src/lib/infrastructure/types.ts",
  "src/lib/infrastructure/inventory.ts",
  "src/ipc/utils/infrastructure/providers.ts",
  "src/ipc/utils/infrastructure/engine.ts",
  "src/ipc/types/infrastructure.ts",
  "src/ipc/handlers/infrastructure_handlers.ts",
  "src/pages/infrastructure.tsx",
];

describe("no service is hardcoded outside the plugins", () => {
  it.each(GUARDED_FILES)("%s names no product", (relativePath) => {
    const contents = fs
      .readFileSync(path.join(ROOT, relativePath), "utf8")
      .toLowerCase();

    for (const product of PRODUCT_NAMES) {
      // "PostgreSQL protocol" as a port convention is a transport name, not a
      // service registry, so the check looks for the bare product token.
      const offending = new RegExp(`\\b${product}\\b`).test(
        contents.replace(/postgresql protocol/g, "wire-protocol"),
      );
      expect(
        offending,
        `${relativePath} mentions "${product}"; product knowledge belongs in identify.ts`,
      ).toBe(false);
    }
  });

  it("the dashboard has no service list of its own", () => {
    const page = fs.readFileSync(
      path.join(ROOT, "src/pages/infrastructure.tsx"),
      "utf8",
    );
    // The failure this prevents: a const array of expected services used as
    // the authoritative inventory.
    expect(page).not.toMatch(/const\s+services\s*=\s*\[/);
    expect(page).toContain("data?.services");
  });

  it("the plugins are the only place a name lives", () => {
    const identify = fs.readFileSync(
      path.join(ROOT, "src/lib/infrastructure/identify.ts"),
      "utf8",
    );
    // Sanity check on the other side: if this file stopped naming anything,
    // the guard above would pass for the wrong reason.
    expect(identify.toLowerCase()).toContain("qdrant");
  });
});
