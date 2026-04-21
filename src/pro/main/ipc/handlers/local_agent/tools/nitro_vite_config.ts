import { parse } from "@babel/parser";
import * as recast from "recast";

const { builders: b, namedTypes: n, visit } = recast.types;

const nitroImportSource = "nitro/vite";

function parseModule(source: string) {
  return recast.parse(source, {
    parser: {
      parse(code: string) {
        return parse(code, {
          sourceType: "module",
          plugins: ["jsx", "typescript"],
        });
      },
    },
  });
}

function getPropertyName(node: {
  key: unknown;
  computed?: boolean;
}): string | null {
  if (node.computed) {
    return null;
  }

  const key = node.key;
  if (n.Identifier.check(key)) {
    return key.name;
  }

  if (n.StringLiteral.check(key) || n.Literal.check(key)) {
    return String(key.value);
  }

  return null;
}

function isNitroPlugin(node: unknown): boolean {
  return (
    n.CallExpression.check(node) &&
    n.Identifier.check(node.callee) &&
    node.callee.name === "nitro"
  );
}

export function patchNitroViteConfig(source: string): {
  content: string;
  changed: boolean;
} {
  const ast = parseModule(source);
  const program = ast.program;
  let changed = false;

  let nitroImport: any = program.body.find(
    (statement: unknown) =>
      n.ImportDeclaration.check(statement) &&
      statement.source.value === nitroImportSource,
  );

  if (!nitroImport) {
    const importDeclaration = b.importDeclaration(
      [b.importSpecifier(b.identifier("nitro"))],
      b.stringLiteral(nitroImportSource),
    );
    const lastImportIndex = [...program.body]
      .map((statement, index) =>
        n.ImportDeclaration.check(statement) ? index : -1,
      )
      .filter((index) => index >= 0)
      .pop();

    if (lastImportIndex === undefined) {
      program.body.unshift(importDeclaration);
    } else {
      program.body.splice(lastImportIndex + 1, 0, importDeclaration);
    }
    nitroImport = importDeclaration;
    changed = true;
  } else {
    const hasNitroSpecifier = nitroImport.specifiers?.some(
      (specifier: unknown) =>
        n.ImportSpecifier.check(specifier) &&
        n.Identifier.check(specifier.imported) &&
        specifier.imported.name === "nitro",
    );

    if (!hasNitroSpecifier) {
      const hasNamespaceSpecifier = nitroImport.specifiers?.some(
        (specifier: unknown) => n.ImportNamespaceSpecifier.check(specifier),
      );
      if (hasNamespaceSpecifier) {
        throw new Error(
          "Could not safely add the Nitro import to vite.config. Please update it manually.",
        );
      }

      nitroImport.specifiers = nitroImport.specifiers ?? [];
      nitroImport.specifiers.push(b.importSpecifier(b.identifier("nitro")));
      changed = true;
    }
  }

  let pluginsArray: {
    elements: unknown[];
  } | null = null;
  visit(ast, {
    visitProperty(path) {
      if (
        !pluginsArray &&
        getPropertyName(path.node) === "plugins" &&
        n.ArrayExpression.check(path.node.value)
      ) {
        pluginsArray = path.node.value;
        return false;
      }

      this.traverse(path);
    },
    visitObjectProperty(path) {
      if (
        !pluginsArray &&
        getPropertyName(path.node) === "plugins" &&
        n.ArrayExpression.check(path.node.value)
      ) {
        pluginsArray = path.node.value;
        return false;
      }

      this.traverse(path);
    },
  });

  if (!pluginsArray) {
    throw new Error(
      "Could not find a Vite plugins array in vite.config. Please update it manually.",
    );
  }

  const pluginArray = pluginsArray as { elements: unknown[] };

  const nitroPluginIndex = pluginArray.elements.findIndex((element: unknown) =>
    isNitroPlugin(element),
  );

  if (nitroPluginIndex === -1) {
    pluginArray.elements.push(b.callExpression(b.identifier("nitro"), []));
    changed = true;
  } else if (nitroPluginIndex !== pluginArray.elements.length - 1) {
    const [nitroPlugin] = pluginArray.elements.splice(nitroPluginIndex, 1);
    pluginArray.elements.push(nitroPlugin);
    changed = true;
  }

  if (!changed) {
    return { content: source, changed: false };
  }

  return {
    content: recast.print(ast, { quote: "double" }).code,
    changed: true,
  };
}
