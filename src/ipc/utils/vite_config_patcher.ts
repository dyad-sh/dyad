import fs from "node:fs/promises";
import path from "node:path";
import * as recast from "recast";
import * as tsParser from "recast/parsers/babel-ts";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { VITE_CONFIG_FILES } from "@/lib/framework_constants";

const b = recast.types.builders;
const n = recast.types.namedTypes;

const NITRO_IMPORT_SOURCE = "nitro/vite";
const NITRO_LOCAL_NAME = "nitro";

export interface ViteConfigBackup {
  filePath: string;
  backup: string | null;
  wasPatched: boolean;
}

export class ViteConfigPatchError extends DyadError {
  constructor(message: string) {
    super(message, DyadErrorKind.Precondition);
    this.name = "ViteConfigPatchError";
  }
}

async function findViteConfig(appPath: string): Promise<string> {
  for (const name of VITE_CONFIG_FILES) {
    const candidate = path.join(appPath, name);
    try {
      await fs.access(candidate);
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  throw new ViteConfigPatchError(
    `No vite.config.{ts,mts,cts,js,mjs,cjs} found in ${appPath}.`,
  );
}

function findDefineConfigCallExpr(ast: any): any | null {
  let found: any = null;
  recast.types.visit(ast, {
    visitExportDefaultDeclaration(p) {
      const decl = p.node.declaration;
      if (
        n.CallExpression.check(decl) &&
        n.Identifier.check(decl.callee) &&
        decl.callee.name === "defineConfig"
      ) {
        found = decl;
      }
      return false;
    },
  });
  return found;
}

function getConfigObjectFromDefineConfig(callExpr: any): any | null {
  const arg = callExpr.arguments?.[0];
  if (!arg) return null;
  if (n.ObjectExpression.check(arg)) return arg;
  if (n.ArrowFunctionExpression.check(arg) || n.FunctionExpression.check(arg)) {
    const body = arg.body;
    if (n.ObjectExpression.check(body)) return body;
    if (n.BlockStatement.check(body)) {
      for (const stmt of body.body) {
        if (
          n.ReturnStatement.check(stmt) &&
          n.ObjectExpression.check(stmt.argument)
        ) {
          return stmt.argument;
        }
      }
    }
  }
  return null;
}

function findPluginsArray(configObj: any): any | null {
  for (const prop of configObj.properties ?? []) {
    if (
      (n.ObjectProperty.check(prop) || n.Property.check(prop)) &&
      !prop.computed &&
      ((n.Identifier.check(prop.key) && prop.key.name === "plugins") ||
        (n.StringLiteral.check(prop.key) && prop.key.value === "plugins")) &&
      n.ArrayExpression.check(prop.value)
    ) {
      return prop.value;
    }
  }
  return null;
}

function pluginsArrayContainsNitroCall(pluginsArr: any): boolean {
  for (const el of pluginsArr.elements ?? []) {
    if (
      el &&
      n.CallExpression.check(el) &&
      n.Identifier.check(el.callee) &&
      el.callee.name === NITRO_LOCAL_NAME
    ) {
      return true;
    }
  }
  return false;
}

type NitroBindingState =
  | { kind: "fromNitroVite" }
  | { kind: "conflict"; source: string }
  | { kind: "none" };

function getNitroBindingState(ast: any): NitroBindingState {
  const program = ast.program;
  if (!program || !Array.isArray(program.body)) return { kind: "none" };

  let conflict: { source: string } | null = null;
  for (const stmt of program.body) {
    if (n.ImportDeclaration.check(stmt)) {
      const sourceValue = n.StringLiteral.check(stmt.source)
        ? stmt.source.value
        : "";
      for (const spec of stmt.specifiers ?? []) {
        const localName = (spec as any).local?.name;
        if (localName !== NITRO_LOCAL_NAME) continue;
        if (sourceValue === NITRO_IMPORT_SOURCE) {
          return { kind: "fromNitroVite" };
        }
        conflict ??= { source: `import from "${sourceValue}"` };
      }
    } else if (n.VariableDeclaration.check(stmt)) {
      for (const decl of stmt.declarations) {
        if (
          n.VariableDeclarator.check(decl) &&
          n.Identifier.check(decl.id) &&
          decl.id.name === NITRO_LOCAL_NAME
        ) {
          conflict ??= { source: "local variable declaration" };
        }
      }
    } else if (
      n.FunctionDeclaration.check(stmt) &&
      stmt.id?.name === NITRO_LOCAL_NAME
    ) {
      conflict ??= { source: "function declaration" };
    }
  }
  return conflict
    ? { kind: "conflict", source: conflict.source }
    : { kind: "none" };
}

function insertNitroImport(ast: any): void {
  const importDecl = b.importDeclaration(
    [b.importSpecifier(b.identifier(NITRO_LOCAL_NAME))],
    b.stringLiteral(NITRO_IMPORT_SOURCE),
  );

  const program = ast.program;
  if (!program || !Array.isArray(program.body)) {
    throw new ViteConfigPatchError(
      "Could not find program body in vite config AST.",
    );
  }
  let lastImportIdx = -1;
  for (let i = 0; i < program.body.length; i++) {
    if (n.ImportDeclaration.check(program.body[i])) lastImportIdx = i;
  }
  program.body.splice(lastImportIdx + 1, 0, importDecl);
}

export async function addNitroToViteConfig(
  appPath: string,
): Promise<ViteConfigBackup> {
  const filePath = await findViteConfig(appPath);
  const original = await fs.readFile(filePath, "utf8");

  let ast: any;
  try {
    ast = recast.parse(original, { parser: tsParser });
  } catch (err) {
    throw new ViteConfigPatchError(
      `Failed to parse ${path.basename(filePath)}: ${(err as Error).message}`,
    );
  }

  const defineConfigCall = findDefineConfigCallExpr(ast);
  if (!defineConfigCall) {
    throw new ViteConfigPatchError(
      `Could not find \`export default defineConfig(...)\` in ${path.basename(filePath)}.`,
    );
  }

  const configObj = getConfigObjectFromDefineConfig(defineConfigCall);
  if (!configObj) {
    throw new ViteConfigPatchError(
      `Could not locate the config object inside defineConfig(...) in ${path.basename(filePath)}.`,
    );
  }

  const pluginsArr = findPluginsArray(configObj);
  if (!pluginsArr) {
    throw new ViteConfigPatchError(
      `Could not find a \`plugins\` array in ${path.basename(filePath)}.`,
    );
  }

  const bindingState = getNitroBindingState(ast);
  if (bindingState.kind === "conflict") {
    throw new ViteConfigPatchError(
      `\`${NITRO_LOCAL_NAME}\` is already bound by ${bindingState.source} in ${path.basename(filePath)}; cannot safely add the Nitro plugin.`,
    );
  }

  if (
    bindingState.kind === "fromNitroVite" &&
    pluginsArrayContainsNitroCall(pluginsArr)
  ) {
    return { filePath, backup: original, wasPatched: false };
  }

  if (bindingState.kind === "none") {
    insertNitroImport(ast);
  }

  if (!pluginsArrayContainsNitroCall(pluginsArr)) {
    pluginsArr.elements.push(
      b.callExpression(b.identifier(NITRO_LOCAL_NAME), []),
    );
  }

  const next = recast.print(ast).code;
  await fs.writeFile(filePath, next, "utf8");
  return { filePath, backup: original, wasPatched: true };
}

export async function restoreViteConfig(
  backup: ViteConfigBackup,
): Promise<void> {
  if (backup.backup === null) return;
  await fs.writeFile(backup.filePath, backup.backup, "utf8");
}
