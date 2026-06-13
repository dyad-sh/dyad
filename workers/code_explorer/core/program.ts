import * as fs from "node:fs";
import * as path from "node:path";
import type { TypeScriptModule } from "./types";

const DEFAULT_CONFIGS = ["tsconfig.app.json", "tsconfig.json"];
const WORKSPACE_CONFIG_DIRS = ["apps", "packages"];
const WORKSPACE_CONFIG_NAMES = ["tsconfig.app.json", "tsconfig.json"];
const MAX_WORKSPACE_CONFIGS_TO_CHECK = 40;
const MAX_PROJECT_REFERENCES = 8;
const MAX_PROJECT_ROOT_PARENT_DEPTH = 60;
const PROJECT_ROOT_MARKERS = [
  "package.json",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "package-lock.json",
  "turbo.json",
  "nx.json",
];

export interface ProjectProgram {
  projectRoot: string;
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

  const workspaceConfig = discoverWorkspaceTsconfigs(appPath)[0];
  if (workspaceConfig) {
    return path.join(appPath, workspaceConfig);
  }

  throw new Error(
    `No TypeScript configuration file found in ${appPath}. Expected one of: ${DEFAULT_CONFIGS.join(", ")} or a nearby apps/*/packages/* workspace config.`,
  );
}

function discoverWorkspaceTsconfigs(appPath: string): string[] {
  const candidates: string[] = [];
  for (const dirName of WORKSPACE_CONFIG_DIRS) {
    const dir = path.join(appPath, dirName);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;

    const children = sortWorkspaceConfigChildren(
      fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name),
    );

    for (const child of children) {
      for (const configName of WORKSPACE_CONFIG_NAMES) {
        const relativePath = path.join(dirName, child, configName);
        if (fs.existsSync(path.join(appPath, relativePath))) {
          candidates.push(relativePath);
          if (candidates.length >= MAX_WORKSPACE_CONFIGS_TO_CHECK) {
            return candidates;
          }
        }
      }
    }
  }

  for (const child of discoverPackageLikeChildren(appPath)) {
    for (const configName of WORKSPACE_CONFIG_NAMES) {
      const relativePath = path.join(child, configName);
      if (fs.existsSync(path.join(appPath, relativePath))) {
        candidates.push(relativePath);
        if (candidates.length >= MAX_WORKSPACE_CONFIGS_TO_CHECK) {
          return candidates;
        }
      }
    }
  }

  return candidates;
}

function discoverPackageLikeChildren(appPath: string): string[] {
  if (!fs.existsSync(appPath) || !fs.statSync(appPath).isDirectory()) {
    return [];
  }

  return sortWorkspaceConfigChildren(
    fs
      .readdirSync(appPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .filter((entry) => entry.name !== "node_modules")
      .filter((entry) =>
        fs.existsSync(path.join(appPath, entry.name, "package.json")),
      )
      .map((entry) => entry.name),
  );
}

function sortWorkspaceConfigChildren(children: string[]): string[] {
  return [...children].sort((left, right) => {
    const scoreDelta =
      workspaceConfigChildScore(left) - workspaceConfigChildScore(right);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return left.localeCompare(right);
  });
}

function workspaceConfigChildScore(child: string): number {
  const normalized = child.toLowerCase();
  let score = 0;
  if (/\b(web|dashboard|frontend|front|client|app)\b/.test(normalized)) {
    score -= 10;
  }
  if (
    /\b(docs?|examples?|storybook|playground|e2e|tests?)\b/.test(normalized)
  ) {
    score += 20;
  }
  return score;
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
  const projectRoot = findProjectRoot(appPath);
  const configs = collectConfigPaths(ts, projectRoot, rootConfig);
  const programs = configs.map((configPath) => ({
    projectRoot,
    tsconfigPath: configPath,
    program: createProgramFromConfig(ts, projectRoot, configPath),
  }));

  if (!programs.some((entry) => entry.program.getRootFileNames().length > 0)) {
    throw new Error(
      `No TypeScript source files found from configuration ${path.relative(projectRoot, rootConfig)}`,
    );
  }

  return programs;
}

function collectConfigPaths(
  ts: TypeScriptModule,
  projectRoot: string,
  rootConfig: string,
): string[] {
  const visited = new Set<string>();
  const queue = [rootConfig];
  const result: string[] = [];

  while (queue.length > 0 && result.length < MAX_PROJECT_REFERENCES + 1) {
    const configPath = path.resolve(queue.shift()!);
    if (visited.has(configPath)) continue;
    visited.add(configPath);
    assertInsideProjectRoot(projectRoot, configPath);
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
  projectRoot: string,
  tsconfigPath: string,
): import("typescript").Program {
  const parsed = readConfig(ts, tsconfigPath);
  const options = { ...parsed.options, noEmit: true };
  const host = ts.createCompilerHost(options, true);
  host.getCurrentDirectory = () => projectRoot;
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

function findProjectRoot(appPath: string): string {
  let projectRoot = path.resolve(appPath);
  let current = projectRoot;

  for (let depth = 0; depth <= MAX_PROJECT_ROOT_PARENT_DEPTH; depth++) {
    const currentHasRootMarker = PROJECT_ROOT_MARKERS.some((marker) =>
      fs.existsSync(path.join(current, marker)),
    );
    if (currentHasRootMarker) {
      projectRoot = current;
    }
    if (fs.existsSync(path.join(current, ".git"))) {
      break;
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return projectRoot;
}

function assertInsideProjectRoot(
  projectRoot: string,
  targetPath: string,
): void {
  const relative = path.relative(projectRoot, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `TypeScript project reference escapes project root: ${targetPath}`,
    );
  }
}
