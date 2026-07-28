import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const DISTRIBUTED_ROOT = path.join(SOURCE_ROOT, "distributed_machines");

function productionTypeScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(file);
    if (
      !/\.tsx?$/.test(entry.name) ||
      /\.(?:test|test_support)\.tsx?$/.test(entry.name)
    ) {
      return [];
    }
    return [file];
  });
}

describe("distributed machine boundaries", () => {
  it("composes the shared state-machine primitives instead of duplicating them", () => {
    const host = fs.readFileSync(
      path.join(DISTRIBUTED_ROOT, "actor_host.ts"),
      "utf8",
    );
    for (const primitive of [
      "TransactionalDispatcher",
      "TaskScope",
      "TimerLeaseScope",
      "createTraceObserver",
    ]) {
      expect(host).toContain(primitive);
      expect(host).not.toMatch(
        new RegExp(`(?:class|function)\\s+${primitive}\\b`),
      );
    }
  });

  it("is consumed only by the explicit main-process transport composition root", () => {
    const offenders = productionTypeScriptFiles(SOURCE_ROOT)
      .filter((file) => !file.startsWith(DISTRIBUTED_ROOT))
      .filter((file) =>
        fs.readFileSync(file, "utf8").includes("@/distributed_machines"),
      )
      .map((file) => path.relative(SOURCE_ROOT, file).replaceAll("\\", "/"))
      // Filesystem enumeration order differs across operating systems.
      // Sort with JavaScript's platform-independent UTF-16 ordering before
      // comparing the inventory.
      .sort();

    expect(offenders).toEqual([
      "app_run/client_definition.ts",
      "app_run/definition.ts",
      "app_run/remote_intent_contract.ts",
      "app_run/remote_manager.ts",
      "chat_stream/definition.ts",
      "chat_stream/remote_manager.ts",
      "chat_stream/transport.ts",
      "github_ops/GithubOpsProvider.tsx",
      "github_ops/client_definition.ts",
      "github_ops/useGithubOps.ts",
      "hooks/useVersionPreview.ts",
      "image_generation/hooks.ts",
      "image_generation/remote_intent_contract.ts",
      "image_generation/transport.ts",
      "ipc/handlers/distributed_machine_handlers.ts",
      "ipc/services/distributed_machine_actor_host.ts",
      "ipc/services/distributed_machine_host.ts",
      "ipc/services/github_ops_definition.ts",
      "ipc/services/image_generation_definition.ts",
      "ipc/services/version_preview_actor_service.ts",
      "ipc/services/version_preview_definition.ts",
      "plan_handoff/definition.ts",
      "plan_handoff/remote_manager.ts",
      "plan_handoff/transport.ts",
      "version_preview/VersionPreviewProvider.tsx",
      "version_preview/client_definition.ts",
    ]);
  });
});
