import { parse } from "@babel/parser";
import * as recast from "recast";
import traverse from "@babel/traverse";

interface ContentChange {
  classes: string[];
  prefixes: string[];
  textContent?: string;
}

interface ComponentAnalysis {
  isDynamic: boolean;
  hasStaticText: boolean;
}

/**
 * Pure function that transforms JSX/TSX content by applying style and text changes
 * @param content - The source code content to transform
 * @param changes - Map of line numbers to their changes
 * @returns The transformed source code
 */
export function transformContent(
  content: string,
  changes: Map<number, ContentChange>,
): string {
  // Parse with babel for compatibility with JSX/TypeScript
  const ast = parse(content, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });

  // Track which lines have been processed to avoid modifying nested elements
  const processedLines = new Set<number>();

  traverse(ast, {
    JSXElement(path) {
      const line = path.node.openingElement.loc?.start.line;

      // Only process if we have changes for this line and haven't processed it yet
      if (line && changes.has(line) && !processedLines.has(line)) {
        processedLines.add(line);
        const change = changes.get(line)!;

        // Check if this element has any nested JSX elements as direct children
        const hasNestedJSX = path.node.children.some(
          (child: any) => child.type === "JSXElement",
        );

        // Skip text content modification if there are nested elements
        const shouldModifyText =
          "textContent" in change &&
          change.textContent !== undefined &&
          !hasNestedJSX;

        // Update className if there are style changes
        if (change.classes.length > 0) {
          const attributes = path.node.openingElement.attributes;
          let classNameAttr = attributes.find(
            (attr: any) =>
              attr.type === "JSXAttribute" && attr.name.name === "className",
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
            const shouldRemoveClass = (cls: string, prefixes: string[]) => {
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
                } else if (prefix === "my-" || prefix === "py-") {
                  // When applying vertical spacing (my/py), remove mt-, mb-, my-/py-, and m-/p- (all sides)
                  const type = prefix[0]; // 'm' or 'p'
                  return (
                    cls.startsWith(`${type}t-`) ||
                    cls.startsWith(`${type}b-`) ||
                    cls.startsWith(`${type}y-`) ||
                    cls.match(new RegExp(`^${type}-\\[`)) // Match m-[...] or p-[...]
                  );
                } else if (prefix === "mx-" || prefix === "px-") {
                  // When applying horizontal spacing (mx/px), remove ml-, mr-, mx-/px-, and m-/p- (all sides)
                  const type = prefix[0]; // 'm' or 'p'
                  return (
                    cls.startsWith(`${type}l-`) ||
                    cls.startsWith(`${type}r-`) ||
                    cls.startsWith(`${type}x-`) ||
                    cls.match(new RegExp(`^${type}-\\[`)) // Match m-[...] or p-[...]
                  );
                } else {
                  // For other prefixes, use simple startsWith
                  return cls.startsWith(prefix);
                }
              });
            };

            let filteredClasses = existingClasses.filter(
              (cls) => !shouldRemoveClass(cls, change.prefixes),
            );

            // Special case: When adding mx-/px- or my-/py-, check if we need to preserve complementary spacing
            // If we're removing m-[value]/p-[value], we should add the complementary directional class
            // BUT only if we're not already adding both directional classes
            const addedClasses: string[] = [];

            // Check for each spacing type (margin and padding)
            ["m", "p"].forEach((type) => {
              const hasDirectionalX = change.prefixes.some(
                (p) => p === `${type}x-`,
              );
              const hasDirectionalY = change.prefixes.some(
                (p) => p === `${type}y-`,
              );

              // Only process if we're adding at least one directional class for this type
              if (!hasDirectionalX && !hasDirectionalY) {
                return; // Skip this type
              }

              // Find if there was an all-sides class (m-[...] or p-[...])
              const allSidesClass = existingClasses.find((cls) =>
                cls.match(new RegExp(`^${type}-\\[([^\\]]+)\\]$`)),
              );

              if (allSidesClass) {
                // Remove the omni-directional class from filtered classes
                filteredClasses = filteredClasses.filter(
                  (cls) => cls !== allSidesClass,
                );

                // Extract the value
                const valueMatch = allSidesClass.match(/\[([^\]]+)\]/);
                if (valueMatch) {
                  const omnidirectionalValue = valueMatch[1];

                  // Only add complementary class if we're not adding both directions
                  if (hasDirectionalX && !hasDirectionalY) {
                    // Adding mx-[], so preserve the value as my-[]
                    addedClasses.push(`${type}y-[${omnidirectionalValue}]`);
                  } else if (hasDirectionalY && !hasDirectionalX) {
                    // Adding my-[], so preserve the value as mx-[]
                    addedClasses.push(`${type}x-[${omnidirectionalValue}]`);
                  }
                  // If both are being added, we don't need to preserve anything
                }
              }
            });

            // Combine filtered, preserved, and new classes
            const updatedClasses = [
              ...filteredClasses,
              ...addedClasses,
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

        if (shouldModifyText) {
          // Check if all children are text nodes (no nested JSX elements)
          const hasOnlyTextChildren = path.node.children.every((child: any) => {
            // JSXElement means there's a nested component/element
            if (child.type === "JSXElement") return false;
            return (
              child.type === "JSXText" ||
              (child.type === "JSXExpressionContainer" &&
                child.expression.type === "StringLiteral")
            );
          });

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

  // Use recast to generate code with preserved formatting
  const output = recast.print(ast);
  return output.code;
}

/**
 * Analyzes a JSX/TSX component at a specific line to determine:
 * - Whether it has dynamic styling (className/style with expressions)
 * - Whether it contains static text content
 */
export function analyzeComponent(
  content: string,
  line: number,
): ComponentAnalysis {
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

  if (!foundElement) {
    return { isDynamic: false, hasStaticText: false };
  }

  let dynamic = false;
  let staticText = false;

  // Check attributes for dynamic styling
  if (foundElement.openingElement.attributes) {
    foundElement.openingElement.attributes.forEach((attr: any) => {
      if (attr.type === "JSXAttribute" && attr.name && attr.name.name) {
        const attrName = attr.name.name;
        if (attrName === "style" || attrName === "className") {
          if (attr.value && attr.value.type === "JSXExpressionContainer") {
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
            if (
              expr.type === "Identifier" ||
              expr.type === "MemberExpression"
            ) {
              dynamic = true;
            }
            // Check for CallExpression (function calls)
            if (expr.type === "CallExpression") {
              dynamic = true;
            }
            // Check for ObjectExpression (inline objects like style={{...}})
            if (expr.type === "ObjectExpression") {
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
