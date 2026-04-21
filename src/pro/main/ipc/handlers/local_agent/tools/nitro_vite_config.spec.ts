import { describe, expect, it } from "vitest";

import { patchNitroViteConfig } from "./nitro_vite_config";

describe("patchNitroViteConfig", () => {
  it("adds the Nitro import and appends nitro() to the plugins array", () => {
    const source = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig(() => ({
  plugins: [react()],
}));
`;

    const result = patchNitroViteConfig(source);

    expect(result.changed).toBe(true);
    expect(result.content).toContain('import { nitro } from "nitro/vite";');
    expect(result.content).toMatch(/plugins:\s*\[react\(\), nitro\(\)\]/);
  });

  it("moves an existing Nitro plugin call to the end without losing its args", () => {
    const source = `import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import react from "@vitejs/plugin-react-swc";

export default defineConfig(() => ({
  plugins: [nitro({ preset: "vercel" }), dyadComponentTagger(), react()],
}));
`;

    const result = patchNitroViteConfig(source);

    expect(result.changed).toBe(true);
    expect(result.content).toMatch(
      /plugins:\s*\[dyadComponentTagger\(\), react\(\), nitro\(\{ preset: "vercel" \}\)\]/,
    );
  });

  it("leaves an already-correct config unchanged", () => {
    const source = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { nitro } from "nitro/vite";

export default defineConfig(() => ({
  plugins: [react(), nitro()],
}));
`;

    const result = patchNitroViteConfig(source);

    expect(result.changed).toBe(false);
    expect(result.content).toBe(source);
  });

  it("throws when the config does not contain a plugins array", () => {
    const source = `import { defineConfig } from "vite";

export default defineConfig(() => ({
  server: {
    port: 8080,
  },
}));
`;

    expect(() => patchNitroViteConfig(source)).toThrow(
      "Could not find a Vite plugins array in vite.config. Please update it manually.",
    );
  });
});
