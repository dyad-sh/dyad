import { describe, expect, it } from "vitest";

import { VALID_INVOKE_CHANNELS } from "@/ipc/preload/channels";
import { dataSourceContracts } from "@/ipc/types/data_source";

/**
 * A contract is only usable if three places agree it exists: the handler
 * registers it, the client calls it, and the preload allowlist permits it.
 *
 * Miss the third and everything typechecks, every test passes, and the
 * feature fails at runtime with "Invalid channel". Nothing static catches
 * that, so it gets an explicit test.
 */
describe("data source IPC channels", () => {
  it("allows every contract channel through the preload bridge", () => {
    const allowed = new Set<string>(VALID_INVOKE_CHANNELS as readonly string[]);

    for (const [name, contract] of Object.entries(dataSourceContracts)) {
      expect(
        allowed.has(contract.channel),
        `"${name}" uses channel "${contract.channel}", which the preload allowlist does not permit`,
      ).toBe(true);
    }
  });

  it("namespaces every channel, so two features cannot collide", () => {
    for (const contract of Object.values(dataSourceContracts)) {
      expect(contract.channel.startsWith("data-source:")).toBe(true);
    }
  });
});
