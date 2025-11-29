import { ipcMain } from "electron";
import fs from "fs/promises";
import path from "path";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";
import { parse } from "@babel/parser";
import generate from "@babel/generator";
import traverse from "@babel/traverse";
import {
  stylesToTailwind,
  extractClassPrefixes,
} from "../../utils/style-utils";

interface StyleChange {
  componentId: string;
  componentName: string;
  relativePath: string;
  lineNumber: number;
  appId: number;
  styles: {
    margin?: { left?: string; right?: string; top?: string; bottom?: string };
    padding?: { left?: string; right?: string; top?: string; bottom?: string };
    dimensions?: { width?: string; height?: string };
    border?: { width?: string; radius?: string; color?: string };
    backgroundColor?: string;
    text?: {
      fontSize?: string;
      fontWeight?: string;
      color?: string;
      fontFamily?: string;
    };
  };
  textContent?: string;
}

export function registerVisualEditingHandlers() {
  ipcMain.handle(
    "applyVisualEditingChanges",
    async (_event, changes: StyleChange[]) => {
      try {
        if (changes.length === 0) return;

        // Get the app to find its path (all changes should be for the same app)
        const appId = changes[0].appId;
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error(`App not found: ${appId}`);
        }

        const appPath = getDyadAppPath(app.path);
        const fileChanges = new Map<
          string,
          Map<
            number,
            { classes: string[]; prefixes: string[]; textContent?: string }
          >
        >();

        // Group changes by file and line
        for (const change of changes) {
          if (!fileChanges.has(change.relativePath)) {
            fileChanges.set(change.relativePath, new Map());
          }
          const tailwindClasses = stylesToTailwind(change.styles);
          const changePrefixes = extractClassPrefixes(tailwindClasses);

          fileChanges.get(change.relativePath)!.set(change.lineNumber, {
            classes: tailwindClasses,
            prefixes: changePrefixes,
            ...(change.textContent !== undefined && {
              textContent: change.textContent,
            }),
          });
        }

        // Apply changes to each file
        for (const [relativePath, lineChanges] of fileChanges) {
          const filePath = path.join(appPath, relativePath);
          const content = await fs.readFile(filePath, "utf-8");

          // Use AST for all changes
          const ast = parse(content, {
            sourceType: "module",
            plugins: ["jsx", "typescript"],
          });

          traverse(ast, {
            JSXElement(path) {
              const line = path.node.openingElement.loc?.start.line;
              if (line && lineChanges.has(line)) {
                const change = lineChanges.get(line)!;

                // Update className if there are style changes
                if (change.classes.length > 0) {
                  const attributes = path.node.openingElement.attributes;
                  let classNameAttr = attributes.find(
                    (attr: any) =>
                      attr.type === "JSXAttribute" &&
                      attr.name.name === "className",
                  ) as any;

                  if (classNameAttr) {
                    // Get existing classes
                    let existingClasses: string[] = [];
                    if (
                      classNameAttr.value &&
                      classNameAttr.value.type === "StringLiteral"
                    ) {
                      existingClasses = classNameAttr.value.value
                        .split(/\s+/)
                        .filter(Boolean);
                    }

                    // Filter out classes with matching prefixes
                    const shouldRemoveClass = (
                      cls: string,
                      prefixes: string[],
                    ) => {
                      return prefixes.some((prefix) => {
                        // Handle font-weight vs font-family distinction
                        if (prefix === "font-weight-") {
                          // Remove font-[numeric] classes
                          const match = cls.match(/^font-\[(\d+)\]$/);
                          return match !== null;
                        } else if (prefix === "font-family-") {
                          // Remove font-[non-numeric] classes
                          const match = cls.match(/^font-\[([^\]]+)\]$/);
                          if (match) {
                            // Check if it's NOT purely numeric (i.e., it's a font-family)
                            return !/^\d+$/.test(match[1]);
                          }
                          return false;
                        } else if (prefix === "text-size-") {
                          // Remove only text-size classes (text-xs, text-3xl, text-[44px], etc.)
                          // but NOT text-center, text-left, text-red-500, etc.
                          const sizeMatch = cls.match(
                            /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/,
                          );
                          if (sizeMatch) return true;
                          // Also match arbitrary text sizes like text-[44px]
                          if (cls.match(/^text-\[[\d.]+[a-z]+\]$/)) return true;
                          return false;
                        } else {
                          // For other prefixes, use simple startsWith
                          return cls.startsWith(prefix);
                        }
                      });
                    };

                    const filteredClasses = existingClasses.filter(
                      (cls) => !shouldRemoveClass(cls, change.prefixes),
                    );

                    // Combine filtered and new classes
                    const updatedClasses = [
                      ...filteredClasses,
                      ...change.classes,
                    ].join(" ");

                    // Update the className value
                    classNameAttr.value = {
                      type: "StringLiteral",
                      value: updatedClasses,
                    };
                  } else {
                    // Add className attribute
                    attributes.push({
                      type: "JSXAttribute",
                      name: { type: "JSXIdentifier", name: "className" },
                      value: {
                        type: "StringLiteral",
                        value: change.classes.join(" "),
                      },
                    });
                  }
                }

                if (
                  "textContent" in change &&
                  change.textContent !== undefined
                ) {
                  // Check if all children are text nodes (no nested JSX elements)
                  const hasOnlyTextChildren = path.node.children.every(
                    (child: any) => {
                      return (
                        child.type === "JSXText" ||
                        (child.type === "JSXExpressionContainer" &&
                          child.expression.type === "StringLiteral")
                      );
                    },
                  );

                  // Only replace children if there are no nested JSX elements
                  if (hasOnlyTextChildren) {
                    path.node.children = [
                      {
                        type: "JSXText",
                        value: change.textContent,
                      } as any,
                    ];
                  }
                }
              }
            },
          });

          // Generate updated code
          const output = generate(ast, {
            retainLines: true,
            compact: false,
          });

          await fs.writeFile(filePath, output.code, "utf-8");
        }
      } catch (error) {
        throw new Error(`Failed to apply visual editing changes: ${error}`);
      }
    },
  );

  ipcMain.handle(
    "analyzeComponent",
    async (
      _event,
      { appId, componentId }: { appId: number; componentId: string },
    ) => {
      try {
        const [filePath, lineStr] = componentId.split(":");
        const line = parseInt(lineStr, 10);

        if (!filePath || isNaN(line)) {
          return { isDynamic: false, hasStaticText: false };
        }

        // Get the app to find its path
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error(`App not found: ${appId}`);
        }

        const appPath = getDyadAppPath(app.path);
        const fullPath = path.join(appPath, filePath);
        const content = await fs.readFile(fullPath, "utf-8");

        const ast = parse(content, {
          sourceType: "module",
          plugins: ["jsx", "typescript"],
        });

        let foundElement: any = null;

        // Simple recursive walker to find JSXElement
        const walk = (node: any): void => {
          if (!node) return;

          if (
            node.type === "JSXElement" &&
            node.openingElement?.loc?.start.line === line
          ) {
            foundElement = node;
            return;
          }

          // Handle arrays (like body of a program or block)
          if (Array.isArray(node)) {
            for (const child of node) {
              walk(child);
              if (foundElement) return;
            }
            return;
          }

          // Handle objects
          for (const key in node) {
            if (
              key !== "loc" &&
              key !== "start" &&
              key !== "end" &&
              node[key] &&
              typeof node[key] === "object"
            ) {
              walk(node[key]);
              if (foundElement) return;
            }
          }
        };

        walk(ast);

        if (foundElement) {
          let dynamic = false;
          let staticText = false;

          // Check attributes for dynamic styling
          if (foundElement.openingElement.attributes) {
            foundElement.openingElement.attributes.forEach((attr: any) => {
              if (attr.type === "JSXAttribute" && attr.name && attr.name.name) {
                const attrName = attr.name.name;
                if (attrName === "style" || attrName === "className") {
                  if (
                    attr.value &&
                    attr.value.type === "JSXExpressionContainer"
                  ) {
                    const expr = attr.value.expression;
                    // Check for conditional/logical/template
                    if (
                      expr.type === "ConditionalExpression" ||
                      expr.type === "LogicalExpression" ||
                      expr.type === "TemplateLiteral"
                    ) {
                      dynamic = true;
                    }
                    // Check for identifiers (variables)
                    if (expr.type === "Identifier") {
                      dynamic = true;
                    }
                    // Check for CallExpression (function calls)
                    if (expr.type === "CallExpression") {
                      dynamic = true;
                    }
                  }
                }
              }
            });
          }

          // Check children for static text
          let allChildrenAreText = true;
          let hasText = false;

          if (foundElement.children && foundElement.children.length > 0) {
            foundElement.children.forEach((child: any) => {
              if (child.type === "JSXText") {
                // It's text (could be whitespace)
                if (child.value.trim().length > 0) hasText = true;
              } else if (
                child.type === "JSXExpressionContainer" &&
                child.expression.type === "StringLiteral"
              ) {
                hasText = true;
              } else {
                // If it's not text (e.g. another Element), mark as not text-only
                allChildrenAreText = false;
              }
            });
          } else {
            // No children
            allChildrenAreText = true;
          }

          if (hasText && allChildrenAreText) {
            staticText = true;
          }

          return { isDynamic: dynamic, hasStaticText: staticText };
        }

        return { isDynamic: false, hasStaticText: false };
      } catch (error) {
        console.error("Failed to analyze component:", error);
        return { isDynamic: false, hasStaticText: false };
      }
    },
  );
}
