import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unsafeEscapeHatchInventory } from "./boundary_inventory.test_support";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");

function productionFiles(directory = SOURCE_ROOT): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          absolute === path.join(SOURCE_ROOT, "distributed_machines", "testing")
        ) {
          return [];
        }
        return productionFiles(absolute);
      }
      if (
        !/\.tsx?$/.test(entry.name) ||
        /\.test(?:_support)?\.tsx?$/.test(entry.name)
      ) {
        return [];
      }
      return [absolute];
    })
    .sort();
}

function relative(file: string): string {
  return path.relative(SOURCE_ROOT, file).replaceAll("\\", "/");
}

function pathsMatching(
  predicate: (source: string, file: string) => boolean,
): string[] {
  return productionFiles()
    .filter((file) => predicate(fs.readFileSync(file, "utf8"), file))
    .map(relative)
    .sort();
}

function locationsMatching(
  pattern: RegExp,
  predicate: (source: string, file: string) => boolean = () => true,
): string[] {
  return productionFiles()
    .flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      if (!predicate(source, file)) return [];
      const matches = [...source.matchAll(new RegExp(pattern.source, "g"))];
      return matches.length === 0
        ? []
        : [`${relative(file)}#${matches.length}`];
    })
    .sort();
}

describe("progressive distributed-machine inventories", () => {
  it("inventories all six production distributed definitions", () => {
    expect(
      pathsMatching(
        (source) =>
          source.includes("createCommandRunner") &&
          source.includes("remote: {") &&
          source.includes('host: "main"'),
      ),
    ).toEqual([
      "app_run/definition.ts",
      "chat_stream/definition.ts",
      "ipc/services/github_ops_definition.ts",
      "ipc/services/image_generation_definition.ts",
      "ipc/services/version_preview_definition.ts",
      "plan_handoff/definition.ts",
    ]);
  });

  it("pins renderer-schema-to-internal-event widening casts", () => {
    expect(locationsMatching(/IntentEventSchema\s+as\s+z\.ZodType/)).toEqual(
      unsafeEscapeHatchInventory.wideningCasts,
    );
  });

  it("pins raw remote dispatch and enqueue call sites", () => {
    expect(
      locationsMatching(
        /\.(?:dispatch|enqueue)\s*\(/,
        (source, file) =>
          file.includes(`${path.sep}distributed_machines${path.sep}`) ||
          source.includes("@/distributed_machines") ||
          source.includes("remoteMachineHost") ||
          source.includes("useImageGenerationActor"),
      ),
    ).toEqual(unsafeEscapeHatchInventory.rawDispatchOrEnqueue);
  });

  it("pins bespoke waiter registries", () => {
    expect(
      locationsMatching(
        /settlementWaiters|waitForSettlement|resolveSettlementsForApp/,
      ),
    ).toEqual(unsafeEscapeHatchInventory.bespokeWaiters);
  });

  it("pins independent subscription and ref-count implementations", () => {
    expect(
      locationsMatching(
        /subscriberCount|referencesPerWindow|totalReferences|retainActorSubscription|subscriptions\s*=\s*new Map/,
      ),
    ).toEqual(unsafeEscapeHatchInventory.subscriptionRefCounts);
  });

  it("pins deletion and reset fences", () => {
    expect(
      locationsMatching(
        /admissionBlockCounts|creationBlockCounts|deletionFences|resetFenceCount/,
      ),
    ).toEqual(unsafeEscapeHatchInventory.deletionResetFences);
  });

  it("pins initiator and routing maps", () => {
    expect(
      locationsMatching(/initiatorBy(?:OperationId|JobId)|windowIdsByAppId/),
    ).toEqual(unsafeEscapeHatchInventory.initiatorRoutingMaps);
  });
});
