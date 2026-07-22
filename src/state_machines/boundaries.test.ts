import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const MACHINE_DIRECTORIES = [
  "app_run",
  "chat_stream",
  "connection_flow",
  "plan_handoff",
  "version_preview",
] as const;

function productionFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(filePath);
    if (
      !/\.tsx?$/.test(entry.name) ||
      /\.(?:test|spec)\.tsx?$/.test(entry.name)
    ) {
      return [];
    }
    return [filePath];
  });
}

function importsIn(filePath: string): string[] {
  const source = fs.readFileSync(filePath, "utf8");
  return [
    ...source.matchAll(/(?:import|export)\s[\s\S]*?\sfrom\s+["']([^"']+)["']/g),
  ].map((match) => match[1]);
}

describe("state-machine boundaries", () => {
  it("keeps the shared kernel independent from domain and platform modules", () => {
    const kernelFiles = productionFiles(
      path.join(SOURCE_ROOT, "state_machines"),
    );
    for (const filePath of kernelFiles) {
      for (const source of importsIn(filePath)) {
        expect(
          source === "react" || source.startsWith("."),
          `${path.relative(SOURCE_ROOT, filePath)} imports ${source}`,
        ).toBe(true);
      }
    }
  });

  it("requires machine-to-machine calls to cross an injected facade", () => {
    for (const machine of MACHINE_DIRECTORIES) {
      const machineRoot = path.join(SOURCE_ROOT, machine);
      for (const filePath of productionFiles(machineRoot)) {
        for (const source of importsIn(filePath)) {
          const aliasMatch = /^@\/([^/]+)(?:\/|$)/.exec(source);
          if (aliasMatch) {
            expect(
              !MACHINE_DIRECTORIES.includes(
                aliasMatch[1] as (typeof MACHINE_DIRECTORIES)[number],
              ) || aliasMatch[1] === machine,
              `${path.relative(SOURCE_ROOT, filePath)} imports ${source}`,
            ).toBe(true);
            continue;
          }
          if (!source.startsWith(".")) continue;
          const resolved = path.resolve(path.dirname(filePath), source);
          const importedMachine = MACHINE_DIRECTORIES.find((candidate) =>
            resolved.startsWith(path.join(SOURCE_ROOT, candidate) + path.sep),
          );
          expect(
            importedMachine === undefined || importedMachine === machine,
            `${path.relative(SOURCE_ROOT, filePath)} imports ${source}`,
          ).toBe(true);
        }
      }
    }
  });
});
