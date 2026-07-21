import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { processSupabaseDependencyAnalysis } from "../../../workers/supabase_dependency_analysis/supabase_dependency_analysis_worker";

describe("Supabase dependency analysis worker", () => {
  it("distinguishes a missing TypeScript install from an incompatible compiler API", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-supabase-no-ts-analysis-"),
    );
    try {
      await expect(
        processSupabaseDependencyAnalysis({
          appPath,
          changedSharedModulePaths: [],
        }),
      ).resolves.toEqual({
        success: true,
        data: { kind: "all", reason: "typescript_not_installed" },
      });
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("uses bundled TypeScript 6 when an installed TS7 lacks the legacy API", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-supabase-ts7-analysis-"),
    );
    try {
      const write = async (relativePath: string, contents: string) => {
        const filePath = path.join(appPath, relativePath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, contents);
      };
      await write(
        "node_modules/typescript/package.json",
        JSON.stringify({
          name: "typescript",
          version: "7.0.2",
          exports: { ".": "./lib/version.cjs" },
        }),
      );
      await write(
        "supabase/functions/_shared/util.ts",
        "export const value = 1;",
      );
      await write(
        "supabase/functions/alpha/index.ts",
        "import '../_shared/util.ts';",
      );
      await write(
        "supabase/functions/beta/index.ts",
        "export const value = 2;",
      );

      await expect(
        processSupabaseDependencyAnalysis({
          appPath,
          changedSharedModulePaths: ["supabase/functions/_shared/util.ts"],
        }),
      ).resolves.toEqual({
        success: true,
        data: { kind: "partial", functionNames: ["alpha"] },
      });
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });
});
