import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { githubContracts } from "@/ipc/types/github";
import { vercelContracts } from "@/ipc/types/vercel";

/**
 * A contract is only usable when three things agree: the channel is declared,
 * a handler is registered for it, and the preload allowlist lets it through.
 *
 * Missing the third produces "Invalid channel" at runtime and nothing at build
 * time, which has already cost this codebase an afternoon once.
 */

const read = (...segments: string[]) =>
  fs.readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");

describe("Dev Ops IPC", () => {
  it("registers a handler for every GitHub and Vercel channel", () => {
    // Every handler file, since a contract can be handled anywhere.
    const dir = path.join(process.cwd(), "src", "ipc", "handlers");
    const handlers = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
      .join("\n");

    const contracts = [
      ...Object.entries(githubContracts),
      ...Object.entries(vercelContracts),
    ];

    const unhandled = contracts
      .filter(([name]) => !new RegExp(`\\.${name}\\b`).test(handlers))
      .map(([name]) => name);

    expect(unhandled, "contracts with no handler registered").toEqual([]);
  });

  it("lets every channel through the preload allowlist", () => {
    // Both contract objects are spread into the allowlist, so a new channel is
    // covered automatically. This asserts that stays true.
    const preload = read("ipc", "preload", "channels.ts");
    expect(preload).toContain("getInvokeChannels(githubContracts)");
    expect(preload).toContain("getInvokeChannels(vercelContracts)");
  });

  it("keeps the file-writing channels distinct from the read ones", () => {
    // Renaming writes and deletes; upload writes. Losing one of these names
    // silently would leave a button wired to nothing.
    for (const name of [
      "renameContent",
      "uploadContent",
      "listCommits",
    ] as const) {
      expect(githubContracts[name].channel).toMatch(/^github:/);
    }
    for (const name of [
      "getProjectDeployments",
      "getProjectDomains",
    ] as const) {
      expect(vercelContracts[name].channel).toMatch(/^vercel:/);
    }
  });
});
