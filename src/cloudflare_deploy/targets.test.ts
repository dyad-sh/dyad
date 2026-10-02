import { describe, expect, it } from "vitest";
import {
  buildsWithNitro,
  describeCloudflareTarget,
  detectCloudflareTargets,
  readWranglerWorkerName,
} from "./targets";

/** Committed file contents by path; anything else cannot be read. */
function committed(files: Record<string, string> = {}) {
  return async (path: string) => files[path] ?? null;
}

const NITRO_MANIFEST = JSON.stringify({ dependencies: { nitro: "^3.0.0" } });

describe("detectCloudflareTargets", () => {
  it("finds a Worker in a subfolder of an app that is not itself one", async () => {
    expect(
      await detectCloudflareTargets(
        [
          "package.json",
          "src/App.tsx",
          "worker/wrangler.jsonc",
          "worker/src/index.ts",
        ],
        committed({ "package.json": "{}" }),
      ),
    ).toEqual([
      {
        kind: "wrangler",
        rootDirectory: "worker",
        configPath: "worker/wrangler.jsonc",
        nitro: false,
      },
    ]);
  });

  it("treats a config at the top level as the root target", async () => {
    expect(
      await detectCloudflareTargets(
        ["wrangler.toml", "src/index.ts"],
        committed(),
      ),
    ).toEqual([
      {
        kind: "wrangler",
        rootDirectory: "",
        configPath: "wrangler.toml",
        nitro: false,
      },
    ]);
  });

  it("orders targets shallowest first so the first one is the default", async () => {
    const targets = await detectCloudflareTargets(
      [
        "services/zeta/wrangler.toml",
        "services/alpha/package.json",
        "api/wrangler.json",
        "nitro.config.ts",
      ],
      committed({ "services/alpha/package.json": NITRO_MANIFEST }),
    );
    expect(targets.map((target) => target.rootDirectory)).toEqual([
      "",
      "api",
      "services/alpha",
      "services/zeta",
    ]);
  });

  it("ignores configs and apps inside dependencies and build output", async () => {
    expect(
      await detectCloudflareTargets(
        [
          "node_modules/some-package/wrangler.toml",
          "node_modules/nitro/package.json",
          ".output/server/wrangler.json",
          ".output/server/package.json",
          ".wrangler/tmp/wrangler.json",
          "dist/wrangler.json",
          "packages/api/node_modules/dep/wrangler.toml",
        ],
        committed({
          "node_modules/nitro/package.json": NITRO_MANIFEST,
          ".output/server/package.json": NITRO_MANIFEST,
        }),
      ),
    ).toEqual([]);
  });

  it("reports a folder once, preferring the config Wrangler itself prefers", async () => {
    expect(
      await detectCloudflareTargets(
        ["api/wrangler.toml", "api/wrangler.json", "api/wrangler.jsonc"],
        committed(),
      ),
    ).toEqual([
      {
        kind: "wrangler",
        rootDirectory: "api",
        configPath: "api/wrangler.json",
        nitro: false,
      },
    ]);
    // Without a wrangler.json, jsonc comes before toml.
    expect(
      await detectCloudflareTargets(
        ["api/wrangler.toml", "api/wrangler.jsonc"],
        committed(),
      ),
    ).toEqual([
      {
        kind: "wrangler",
        rootDirectory: "api",
        configPath: "api/wrangler.jsonc",
        nitro: false,
      },
    ]);
  });

  it("does not mistake similarly named files for a config", async () => {
    expect(
      await detectCloudflareTargets(
        ["docs/wrangler.toml.md", "my-wrangler.toml", "wrangler.toml.bak"],
        committed(),
      ),
    ).toEqual([]);
  });

  it("accepts Windows separators", async () => {
    expect(
      await detectCloudflareTargets(["worker\\wrangler.toml"], committed()),
    ).toEqual([
      {
        kind: "wrangler",
        rootDirectory: "worker",
        configPath: "worker/wrangler.toml",
        nitro: false,
      },
    ]);
  });

  describe("Nitro apps", () => {
    it("finds an app by its Nitro config without reading anything", async () => {
      expect(
        await detectCloudflareTargets(
          ["package.json", "nitro.config.ts", "vite.config.ts"],
          async () => {
            throw new Error("should not read");
          },
        ),
      ).toEqual([{ kind: "nitro", rootDirectory: "" }]);
    });

    it("finds an app by the nitro dependency in its manifest", async () => {
      expect(
        await detectCloudflareTargets(
          ["package.json", "apps/site/package.json", "apps/docs/package.json"],
          committed({
            "package.json": JSON.stringify({
              devDependencies: { react: "19" },
            }),
            "apps/site/package.json": JSON.stringify({
              devDependencies: { nitro: "latest" },
            }),
            "apps/docs/package.json": JSON.stringify({ dependencies: {} }),
          }),
        ),
      ).toEqual([{ kind: "nitro", rootDirectory: "apps/site" }]);
    });

    it("is not fooled by a manifest that cannot be read or parsed", async () => {
      expect(
        await detectCloudflareTargets(
          ["package.json", "broken/package.json"],
          committed({ "broken/package.json": "{ nitro" }),
        ),
      ).toEqual([]);
    });

    it("lets a Wrangler config in the same folder decide, and says the folder is Nitro", async () => {
      expect(
        await detectCloudflareTargets(
          ["wrangler.jsonc", "nitro.config.ts", "package.json"],
          async () => {
            throw new Error("should not read");
          },
        ),
      ).toEqual([
        {
          kind: "wrangler",
          rootDirectory: "",
          configPath: "wrangler.jsonc",
          nitro: true,
        },
      ]);
      expect(
        await detectCloudflareTargets(
          ["api/wrangler.toml", "api/package.json"],
          committed({ "api/package.json": NITRO_MANIFEST }),
        ),
      ).toEqual([
        {
          kind: "wrangler",
          rootDirectory: "api",
          configPath: "api/wrangler.toml",
          nitro: true,
        },
      ]);
    });

    it("reads every manifest at once rather than one after another", async () => {
      let pending = 0;
      let mostPending = 0;
      const targets = await detectCloudflareTargets(
        ["a/package.json", "b/package.json", "c/package.json"],
        async () => {
          pending++;
          mostPending = Math.max(mostPending, pending);
          await new Promise((resolve) => setTimeout(resolve, 0));
          pending--;
          return NITRO_MANIFEST;
        },
      );
      expect(mostPending).toBe(3);
      expect(targets.map((target) => target.rootDirectory)).toEqual([
        "a",
        "b",
        "c",
      ]);
    });
  });
});

describe("buildsWithNitro", () => {
  it("is true for a Nitro app, with or without a Wrangler config", () => {
    expect(buildsWithNitro({ kind: "nitro", rootDirectory: "" })).toBe(true);
    expect(
      buildsWithNitro({
        kind: "wrangler",
        rootDirectory: "",
        configPath: "wrangler.json",
        nitro: true,
      }),
    ).toBe(true);
    expect(
      buildsWithNitro({
        kind: "wrangler",
        rootDirectory: "",
        configPath: "wrangler.json",
        nitro: false,
      }),
    ).toBe(false);
  });
});

describe("describeCloudflareTarget", () => {
  it("names the root and shows a subfolder by its path", () => {
    expect(describeCloudflareTarget({ kind: "nitro", rootDirectory: "" })).toBe(
      "App root",
    );
    expect(
      describeCloudflareTarget({
        kind: "wrangler",
        rootDirectory: "services/api",
        configPath: "services/api/wrangler.toml",
        nitro: false,
      }),
    ).toBe("services/api");
  });
});

describe("readWranglerWorkerName", () => {
  it("reads the name from JSON with comments and trailing commas", () => {
    const contents = `{
      // The Worker's name
      "$schema": "node_modules/wrangler/config-schema.json",
      "name": "orders-api", /* inline */
      "main": "src/index.ts",
      "vars": { "DOCS": "https://example.com/a//b" },
    }`;
    expect(readWranglerWorkerName("wrangler.jsonc", contents)).toBe(
      "orders-api",
    );
  });

  it("reads the top-level name from TOML", () => {
    const contents = `# config\nname = "orders-api"\nmain = "src/index.ts"\n`;
    expect(readWranglerWorkerName("wrangler.toml", contents)).toBe(
      "orders-api",
    );
    expect(readWranglerWorkerName("wrangler.toml", "name = 'single'")).toBe(
      "single",
    );
  });

  it("does not take a name that belongs to a TOML table", () => {
    const contents = `main = "src/index.ts"\n\n[env.staging]\nname = "orders-api-staging"\n`;
    expect(readWranglerWorkerName("wrangler.toml", contents)).toBeNull();
  });

  it("returns null when there is no usable name", () => {
    expect(readWranglerWorkerName("wrangler.json", "{ not json")).toBeNull();
    expect(readWranglerWorkerName("wrangler.json", `{"main":"x"}`)).toBeNull();
    expect(readWranglerWorkerName("wrangler.json", `{"name": 3}`)).toBeNull();
    expect(
      readWranglerWorkerName("wrangler.json", `{"name": "  "}`),
    ).toBeNull();
  });
});
