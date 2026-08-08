import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ViteConfigPatchError,
  addNitroToViteConfig,
  restoreViteConfig,
} from "./vite_config_patcher";

describe("vite_config_patcher", () => {
  let appPath: string;

  beforeEach(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "vite-config-patcher-"));
  });

  afterEach(async () => {
    await fs.rm(appPath, { recursive: true, force: true });
  });

  async function writeConfig(filename: string, contents: string) {
    await fs.writeFile(path.join(appPath, filename), contents, "utf8");
  }

  async function readConfig(filename: string) {
    return fs.readFile(path.join(appPath, filename), "utf8");
  }

  it("adds nitro import and appends nitro() last in the standard scaffold form", async () => {
    const original = `import { defineConfig } from "vite";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [dyadComponentTagger(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
`;
    await writeConfig("vite.config.ts", original);

    const result = await addNitroToViteConfig(appPath);

    expect(result.wasPatched).toBe(true);
    expect(result.backup).toBe(original);
    expect(result.filePath).toBe(path.join(appPath, "vite.config.ts"));

    const next = await readConfig("vite.config.ts");
    expect(next).toContain(`import { nitro } from "nitro/vite"`);

    const pluginsMatch = next.match(/plugins:\s*\[([^\]]*)\]/);
    expect(pluginsMatch).not.toBeNull();
    const pluginsText = pluginsMatch![1].replace(/\s+/g, " ").trim();
    expect(pluginsText).toBe("dyadComponentTagger(), react(), nitro()");

    expect(next).toContain('host: "::"');
    expect(next).toContain('"@": path.resolve(__dirname, "./src")');
  });

  it("handles defineConfig({ ... }) (no callback wrapper)", async () => {
    const original = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
});
`;
    await writeConfig("vite.config.ts", original);

    await addNitroToViteConfig(appPath);

    const next = await readConfig("vite.config.ts");
    expect(next).toContain(`import { nitro } from "nitro/vite"`);
    const pluginsMatch = next.match(/plugins:\s*\[([^\]]*)\]/);
    expect(pluginsMatch).not.toBeNull();
    expect(pluginsMatch![1].replace(/\s+/g, " ").trim()).toBe(
      "react(), nitro()",
    );
  });

  it("handles defineConfig(({ mode }) => ({ ... })) with parameter", async () => {
    const original = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  mode,
}));
`;
    await writeConfig("vite.config.ts", original);

    await addNitroToViteConfig(appPath);

    const next = await readConfig("vite.config.ts");
    expect(next).toContain(`import { nitro } from "nitro/vite"`);
    expect(next).toContain("nitro()");
    expect(next).toMatch(/plugins:\s*\[react\(\),\s*nitro\(\)\]/);
  });

  it("handles a function-body return statement", async () => {
    const original = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig(() => {
  return {
    plugins: [react()],
  };
});
`;
    await writeConfig("vite.config.ts", original);

    await addNitroToViteConfig(appPath);

    const next = await readConfig("vite.config.ts");
    expect(next).toContain(`import { nitro } from "nitro/vite"`);
    expect(next).toMatch(/plugins:\s*\[react\(\),\s*nitro\(\)\]/);
  });

  it("is idempotent — running twice leaves the file unchanged on the second call", async () => {
    const original = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig(() => ({
  plugins: [react()],
}));
`;
    await writeConfig("vite.config.ts", original);

    await addNitroToViteConfig(appPath);
    const afterFirst = await readConfig("vite.config.ts");

    const second = await addNitroToViteConfig(appPath);
    const afterSecond = await readConfig("vite.config.ts");

    expect(second.wasPatched).toBe(false);
    expect(afterSecond).toBe(afterFirst);
  });

  it("places nitro() last even when other plugins are present (e.g. tailwindcss)", async () => {
    const original = `import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
}));
`;
    await writeConfig("vite.config.ts", original);

    await addNitroToViteConfig(appPath);

    const next = await readConfig("vite.config.ts");
    const pluginsMatch = next.match(/plugins:\s*\[([^\]]*)\]/);
    expect(pluginsMatch).not.toBeNull();
    expect(pluginsMatch![1].replace(/\s+/g, " ").trim()).toBe(
      "react(), tailwindcss(), nitro()",
    );
  });

  it("throws ViteConfigPatchError when no plugins array is present", async () => {
    const original = `import { defineConfig } from "vite";

export default defineConfig({
  server: { host: "::" },
});
`;
    await writeConfig("vite.config.ts", original);

    await expect(addNitroToViteConfig(appPath)).rejects.toBeInstanceOf(
      ViteConfigPatchError,
    );
  });

  it("throws ViteConfigPatchError when no defineConfig export is present", async () => {
    const original = `import react from "@vitejs/plugin-react-swc";

export default {
  plugins: [react()],
};
`;
    await writeConfig("vite.config.ts", original);

    await expect(addNitroToViteConfig(appPath)).rejects.toBeInstanceOf(
      ViteConfigPatchError,
    );
  });

  it("throws ViteConfigPatchError when no vite.config.* file exists", async () => {
    await expect(addNitroToViteConfig(appPath)).rejects.toBeInstanceOf(
      ViteConfigPatchError,
    );
  });

  it("falls back to .mjs when .ts is absent", async () => {
    const original = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
});
`;
    await writeConfig("vite.config.mjs", original);

    const result = await addNitroToViteConfig(appPath);

    expect(result.filePath).toBe(path.join(appPath, "vite.config.mjs"));
    const next = await readConfig("vite.config.mjs");
    expect(next).toContain(`import { nitro } from "nitro/vite"`);
    expect(next).toContain("nitro()");
  });

  it("restoreViteConfig round-trips back to the original bytes", async () => {
    const original = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig(() => ({
  plugins: [react()],
}));
`;
    await writeConfig("vite.config.ts", original);

    const backup = await addNitroToViteConfig(appPath);
    expect(await readConfig("vite.config.ts")).not.toBe(original);

    await restoreViteConfig(backup);
    expect(await readConfig("vite.config.ts")).toBe(original);
  });

  it("restoreViteConfig with backup=null is a no-op", async () => {
    const original = `import { defineConfig } from "vite";
export default defineConfig({ plugins: [] });
`;
    await writeConfig("vite.config.ts", original);

    await restoreViteConfig({
      filePath: path.join(appPath, "vite.config.ts"),
      backup: null,
      wasPatched: false,
    });

    expect(await readConfig("vite.config.ts")).toBe(original);
  });

  it("throws ViteConfigPatchError when `nitro` is already bound from a different source", async () => {
    const original = `import { defineConfig } from "vite";
import { nitro } from "some-other-package";
import react from "@vitejs/plugin-react-swc";

export default defineConfig(() => ({
  plugins: [react(), nitro()],
}));
`;
    await writeConfig("vite.config.ts", original);

    await expect(addNitroToViteConfig(appPath)).rejects.toBeInstanceOf(
      ViteConfigPatchError,
    );

    expect(await readConfig("vite.config.ts")).toBe(original);
  });

  it("adds only the nitro import if plugins already contains nitro()", async () => {
    const original = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig(() => ({
  plugins: [react(), nitro()],
}));
`;
    await writeConfig("vite.config.ts", original);

    const result = await addNitroToViteConfig(appPath);

    expect(result.wasPatched).toBe(true);
    const next = await readConfig("vite.config.ts");
    expect(next).toContain(`import { nitro } from "nitro/vite"`);
    const matches = next.match(/nitro\(\)/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
