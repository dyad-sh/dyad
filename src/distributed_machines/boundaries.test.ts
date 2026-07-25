import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const DISTRIBUTED_ROOT = path.join(SOURCE_ROOT, "distributed_machines");

function productionTypeScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(file);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
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
      .map((file) => path.relative(SOURCE_ROOT, file).replaceAll("\\", "/"));

    expect(offenders).toEqual(["ipc/handlers/distributed_machine_handlers.ts"]);
  });
});
