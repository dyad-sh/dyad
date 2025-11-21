import { ipcMain } from "electron";
import fs from "fs/promises";
import path from "path";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";

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
  };
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
          Map<number, { classes: string[]; prefixes: string[] }>
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
          });
        }

        // Apply changes to each file
        for (const [relativePath, lineChanges] of fileChanges) {
          const filePath = path.join(appPath, relativePath);
          const content = await fs.readFile(filePath, "utf-8");
          const lines = content.split("\n");

          // Update lines
          for (const [lineNumber, { classes, prefixes }] of lineChanges) {
            const lineIndex = lineNumber - 1;
            if (lineIndex >= 0 && lineIndex < lines.length) {
              lines[lineIndex] = updateClassNames(
                lines[lineIndex],
                classes,
                prefixes,
              );
            }
          }

          await fs.writeFile(filePath, lines.join("\n"), "utf-8");
        }
      } catch (error) {
        throw new Error(`Failed to apply visual editing changes: ${error}`);
      }
    },
  );
}
