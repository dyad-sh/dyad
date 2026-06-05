import * as fs from "node:fs";
import * as path from "node:path";
import type { TypeScriptModule } from "./types";

const DEFAULT_CONFIGS = ["tsconfig.app.json", "tsconfig.json"];
const MAX_PROJECT_REFERENCES = 8;

export interface ProjectProgram {
  tsconfigPath: string;
  program: import("typescript").Program;
}

export function resolveTsconfigPath({
  appPath,
  tsconfigPath,
}: {
  appPath: string;
  tsconfigPath?: string;
}): string {
  if (tsconfigPath) {
    const resolved = path.resolve(appPath, tsconfigPath);
    const relative = path.relative(appPath, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Invalid tsconfig_path outside app: ${tsconfigPath}`);
    }
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `TypeScript configuration file not found: ${tsconfigPath}`,
      );
    }
    return resolved;
  }

  for (const config of DEFAULT_CONFIGS) {
    const configPath = path.join(appPath, config);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }

  throw new Error(
    `No TypeScript configuration file found in ${appPath}. Expected one of: ${DEFAULT_CONFIGS.join(", ")}`,
  );
}

export function createProjectPrograms(
  ts: TypeScriptModule,
  {
    appPath,
    tsconfigPath,
  }: {
    appPath: string;
    tsconfigPath?: string;
  },
): ProjectProgram[] {
  const rootConfig = resolveTsconfigPath({ appPath, tsconfigPath });
  const configs = collectConfigPaths(ts, appPath, rootConfig);
  const programs = configs.map((configPath) => ({
    tsconfigPath: configPath,
    program: createProgramFromConfig(ts, appPath, configPath),
  }));

  if (!programs.some((entry) => entry.program.getRootFileNames().length > 0)) {
    throw new Error(
      `No TypeScript source files found from configuration ${path.relative(appPath, rootConfig)}`,
    );
  }

  return programs;
}

function collectConfigPaths(
  ts: TypeScriptModule,
  appPath: string,
  rootConfig: string,
): string[] {
  const visited = new Set<string>();
  const queue = [rootConfig];
  const result: string[] = [];

  while (queue.length > 0 && result.length < MAX_PROJECT_REFERENCES + 1) {
    const configPath = path.resolve(queue.shift()!);
    if (visited.has(configPath)) continue;
    visited.add(configPath);
    assertInsideApp(appPath, configPath);
    result.push(configPath);

    const parsed = readConfig(ts, configPath);
    const references = parsed.projectReferences ?? [];
    for (const ref of references) {
      const referenceBase = path.resolve(path.dirname(configPath), ref.path);
      const resolvedReference =
        fs.existsSync(referenceBase) && fs.statSync(referenceBase).isDirectory()
          ? path.join(referenceBase, "tsconfig.json")
          : referenceBase;
      if (fs.existsSync(resolvedReference)) {
        queue.push(resolvedReference);
      }
    }
  }

  return result;
}

function createProgramFromConfig(
  ts: TypeScriptModule,
  appPath: string,
  tsconfigPath: string,
): import("typescript").Program {
  const parsed = readConfig(ts, tsconfigPath);
  const options = { ...parsed.options, noEmit: true };
  const host = ts.createCompilerHost(options, true);
  host.getCurrentDirectory = () => appPath;
  return ts.createProgram({
    rootNames: parsed.fileNames,
    options,
    host,
    projectReferences: parsed.projectReferences,
    configFileParsingDiagnostics: ts.getConfigFileParsingDiagnostics(parsed),
  });
}

function readConfig(
  ts: TypeScriptModule,
  tsconfigPath: string,
): import("typescript").ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(tsconfigPath, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(
        `TypeScript config error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
      );
    },
  });

  if (!parsed) {
    throw new Error(`Failed to parse TypeScript config: ${tsconfigPath}`);
  }
  return parsed;
}

function assertInsideApp(appPath: string, targetPath: string): void {
  const relative = path.relative(appPath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`TypeScript project reference escapes app: ${targetPath}`);
  }
}
