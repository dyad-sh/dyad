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

interface StyleChange {
  componentId: string;
  componentName: string;
  relativePath: string;
  lineNumber: number;
  appId: number;
  styles: {
    margin?: Record<string, string>;
    padding?: Record<string, string>;
    dimensions?: Record<string, string>;
    border?: Record<string, string>;
    backgroundColor?: string;
    text?: Record<string, string>;
  };
  textContent?: string;
}

const stylesToTailwind = (styles: StyleChange["styles"]): string[] => {
  const classes: string[] = [];

  // Convert margin
  if (styles.margin) {
    const { left, right, top, bottom } = styles.margin;

    const hasHorizontal = left !== undefined && right !== undefined;
    const hasVertical = top !== undefined && bottom !== undefined;

    if (
      hasHorizontal &&
      hasVertical &&
      left === right &&
      top === bottom &&
      left === top
    ) {
      classes.push(`m-[${left}]`);
    } else {
      if (hasHorizontal && left === right) {
        classes.push(`mx-[${left}]`);
      } else {
        if (left !== undefined) classes.push(`ml-[${left}]`);
        if (right !== undefined) classes.push(`mr-[${right}]`);
      }

      if (hasVertical && top === bottom) {
        classes.push(`my-[${top}]`);
      } else {
        if (top !== undefined) classes.push(`mt-[${top}]`);
        if (bottom !== undefined) classes.push(`mb-[${bottom}]`);
      }
    }
  }

  // Convert padding
  if (styles.padding) {
    const { left, right, top, bottom } = styles.padding;

    const hasHorizontal = left !== undefined && right !== undefined;
    const hasVertical = top !== undefined && bottom !== undefined;

    if (
      hasHorizontal &&
      hasVertical &&
      left === right &&
      top === bottom &&
      left === top
    ) {
      classes.push(`p-[${left}]`);
    } else {
      if (hasHorizontal && left === right) {
        classes.push(`px-[${left}]`);
      } else {
        if (left !== undefined) classes.push(`pl-[${left}]`);
        if (right !== undefined) classes.push(`pr-[${right}]`);
      }

      if (hasVertical && top === bottom) {
        classes.push(`py-[${top}]`);
      } else {
        if (top !== undefined) classes.push(`pt-[${top}]`);
        if (bottom !== undefined) classes.push(`pb-[${bottom}]`);
      }
    }
  }

  // Convert dimensions
  if (styles.dimensions) {
    if (styles.dimensions.width !== undefined)
      classes.push(`w-[${styles.dimensions.width}]`);
    if (styles.dimensions.height !== undefined)
      classes.push(`h-[${styles.dimensions.height}]`);
  }

  // Convert border
  if (styles.border) {
    if (styles.border.width !== undefined)
      classes.push(`border-[${styles.border.width}]`);
    if (styles.border.radius !== undefined)
      classes.push(`rounded-[${styles.border.radius}]`);
    if (styles.border.color !== undefined)
      classes.push(`border-[${styles.border.color}]`);
  }

  // Convert background color
  if (styles.backgroundColor !== undefined) {
    classes.push(`bg-[${styles.backgroundColor}]`);
  }

  // Convert text styles
  if (styles.text) {
    if (styles.text.fontSize !== undefined)
      classes.push(`text-[${styles.text.fontSize}]`);
    if (styles.text.fontWeight !== undefined)
      classes.push(`font-[${styles.text.fontWeight}]`);
    if (styles.text.color !== undefined)
      classes.push(`[color:${styles.text.color}]`);
  }

  return classes;
};

const updateClassNames = (
  line: string,
  newClasses: string[],
  changePrefixes: string[],
): string => {
  const classNameRegex = /className=["']([^"']*)["']/;
  const match = line.match(classNameRegex);

  if (!match) {
    // No className attribute, add one
    const tagEnd = line.indexOf(">");
    if (tagEnd === -1) return line;
    return (
      line.slice(0, tagEnd) +
      ` className="${newClasses.join(" ")}"` +
      line.slice(tagEnd)
    );
  }

  const existingClasses = match[1].split(/\s+/).filter(Boolean);

  // Only remove classes that match the prefixes we're changing
  const filteredClasses = existingClasses.filter(
    (cls) => !changePrefixes.some((prefix) => cls.startsWith(prefix)),
  );

  const updatedClasses = [...filteredClasses, ...newClasses].join(" ");
  return line.replace(classNameRegex, `className="${updatedClasses}"`);
};

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

          // Extract prefixes from the new classes to know what to replace
          const changePrefixes = Array.from(
            new Set(
              tailwindClasses.map((cls) => {
                const match = cls.match(/^([a-z]+-)/);
                return match ? match[1] : cls.split("-")[0] + "-";
              }),
            ),
          );

          fileChanges.get(change.relativePath)!.set(change.lineNumber, {
            classes: tailwindClasses,
            prefixes: changePrefixes,
            textContent: change.textContent,
          });
        }

        // Apply changes to each file
        for (const [relativePath, lineChanges] of fileChanges) {
          const filePath = path.join(appPath, relativePath);
          const content = await fs.readFile(filePath, "utf-8");

          // Check if any text content changes exist
          const hasTextChanges = Array.from(lineChanges.values()).some(
            (change) => change.textContent !== undefined,
          );

          if (hasTextChanges) {
            // Use AST for text content changes
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
                      const filteredClasses = existingClasses.filter(
                        (cls) =>
                          !change.prefixes.some((prefix) =>
                            cls.startsWith(prefix),
                          ),
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

                  // Update text content if provided
                  if (change.textContent !== undefined) {
                    path.node.children = [
                      {
                        type: "JSXText",
                        value: change.textContent,
                      } as any,
                    ];
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
          } else {
            // No text changes, use simple line-based approach for performance
            const lines = content.split("\n");

            for (const [lineNumber, { classes, prefixes }] of lineChanges) {
              const lineIndex = lineNumber - 1;
              if (lineIndex >= 0 && lineIndex < lines.length) {
                let updatedLine = lines[lineIndex];

                if (classes.length > 0) {
                  updatedLine = updateClassNames(
                    updatedLine,
                    classes,
                    prefixes,
                  );
                }

                lines[lineIndex] = updatedLine;
              }
            }

            await fs.writeFile(filePath, lines.join("\n"), "utf-8");
          }
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
