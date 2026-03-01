import { parse } from "@babel/parser";
import MagicString from "magic-string";
import path from "node:path";
import { walk } from "estree-walker";

const VALID_EXTENSIONS = new Set([".jsx", ".tsx"]);

/**
 * A webpack loader that adds `data-coney-*` attributes to JSX elements.
 */
export default function coneyTaggerLoader(this: any, code: string) {
  // Signal that this is an async loader
  const callback = this.async();

  const transform = async () => {
    try {
      // Skip non-JSX files and node_modules
      if (
        !VALID_EXTENSIONS.has(path.extname(this.resourcePath)) ||
        this.resourcePath.includes("node_modules")
      ) {
        return null;
      }

      // Parse the AST
      const ast = parse(code, {
        sourceType: "module",
        plugins: ["jsx", "typescript"],
        sourceFilename: this.resourcePath,
      });

      const ms = new MagicString(code);
      const fileRelative = path.relative(this.rootContext, this.resourcePath);
      let transformCount = 0;

      // Walk the AST and transform JSX elements
      walk(ast as any, {
        enter: (node: any) => {
          try {
            if (node.type !== "JSXOpeningElement") return;

            // Extract the tag/component name
            if (node.name?.type !== "JSXIdentifier") return;
            const tagName = node.name.name;
            if (!tagName) return;

            // Skip if already tagged
            const alreadyTagged = node.attributes?.some(
              (attr: any) =>
                attr.type === "JSXAttribute" &&
                attr.name?.name === "data-coney-id",
            );
            if (alreadyTagged) return;

            // Build the coney ID
            const loc = node.loc?.start;
            if (!loc) return;
            const coneyId = `${fileRelative}:${loc.line}:${loc.column}`;

            // Inject the attributes
            if (node.name.end != null) {
              ms.appendLeft(
                node.name.end,
                ` data-coney-id="${coneyId}" data-coney-name="${tagName}"`,
              );
              transformCount++;
            }
          } catch (error) {
            console.warn(
              `[coney-tagger] Warning: Failed to process JSX node in ${this.resourcePath}:`,
              error,
            );
          }
        },
      });

      // Return null if no changes were made
      if (transformCount === 0) {
        return null;
      }

      const transformedCode = ms.toString();
      return {
        code: transformedCode,
        map: ms.generateMap({ hires: true }),
      };
    } catch (error) {
      console.warn(
        `[coney-tagger] Warning: Failed to transform ${this.resourcePath}:`,
        error,
      );
      return null;
    }
  };

  transform()
    .then((result) => {
      if (result) {
        callback(null, result.code, result.map);
      } else {
        callback(null, code);
      }
    })
    .catch((err) => {
      console.error(`[coney-tagger] ERROR in ${this.resourcePath}:`, err);
      // Return original code instead of throwing
      callback(null, code);
    });
}
