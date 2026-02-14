import { ipcMain } from "electron";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "path";
import { db } from "../../../../db";
import { apps } from "../../../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../../../paths/paths";
import {
  stylesToTailwind,
  extractClassPrefixes,
} from "../../../../utils/style-utils";
import { gitAdd, gitCommit } from "../../../../ipc/utils/git_utils";
import { safeJoin } from "@/ipc/utils/path_utils";
import {
  AnalyseComponentParams,
  ApplyVisualEditingChangesParams,
} from "@/ipc/types";
import {
  transformContent,
  analyzeComponent,
} from "../../utils/visual_editing_utils";
import { normalizePath } from "../../../../../shared/normalizePath";

const VALID_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

const MAX_IMAGE_SIZE = 10_000_000; // ~7.5MB decoded

export function registerVisualEditingHandlers() {
  ipcMain.handle(
    "apply-visual-editing-changes",
    async (_event, params: ApplyVisualEditingChangesParams) => {
      const { appId, changes } = params;
      try {
        if (changes.length === 0) return;

        // Get the app to find its path
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error(`App not found: ${appId}`);
        }

        const appPath = getDyadAppPath(app.path);
        // Process image uploads - write files to public directory
        for (const change of changes) {
          if (change.imageUpload) {
            const { fileName, base64Data, mimeType } = change.imageUpload;

            // Validate MIME type against allowlist
            if (!VALID_IMAGE_MIME_TYPES.includes(mimeType)) {
              throw new Error(
                `Unsupported image type: ${mimeType}. Allowed types: ${VALID_IMAGE_MIME_TYPES.join(", ")}`,
              );
            }

            // Validate file size
            if (base64Data.length > MAX_IMAGE_SIZE) {
              throw new Error(
                "Image file is too large. Maximum size is approximately 7.5MB.",
              );
            }

            // Sanitize filename
            const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
            const timestamp = Date.now();
            const finalFileName = `${timestamp}-${sanitizedFileName}`;

            // Ensure the public/images directory exists
            const publicImagesDir = path.join(appPath, "public", "images");
            await fsPromises.mkdir(publicImagesDir, { recursive: true });

            // Write the file from base64
            const destPath = path.join(publicImagesDir, finalFileName);
            const buffer = Buffer.from(
              base64Data.replace(/^data:[^;]+;base64,/, ""),
              "base64",
            );
            await fsPromises.writeFile(destPath, buffer);

            // Update imageSrc to match the actual filename written to disk
            change.imageSrc = `/images/${finalFileName}`;

            // Git-add the uploaded image
            if (fs.existsSync(path.join(appPath, ".git"))) {
              await gitAdd({
                path: appPath,
                filepath: normalizePath(
                  path.join("public", "images", finalFileName),
                ),
              });
            }
          }
        }

        const fileChanges = new Map<
          string,
          Map<
            number,
            {
              classes: string[];
              prefixes: string[];
              textContent?: string;
              imageSrc?: string;
            }
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
            ...(change.imageSrc !== undefined && {
              imageSrc: change.imageSrc,
            }),
          });
        }

        // Apply changes to each file
        for (const [relativePath, lineChanges] of fileChanges) {
          const normalizedRelativePath = normalizePath(relativePath);
          const filePath = safeJoin(appPath, normalizedRelativePath);
          const content = await fsPromises.readFile(filePath, "utf-8");
          const transformedContent = transformContent(content, lineChanges);
          await fsPromises.writeFile(filePath, transformedContent, "utf-8");
          // Check if git repository exists and commit the change
          if (fs.existsSync(path.join(appPath, ".git"))) {
            await gitAdd({
              path: appPath,
              filepath: normalizedRelativePath,
            });

            await gitCommit({
              path: appPath,
              message: `Updated ${normalizedRelativePath}`,
            });
          }
        }
      } catch (error) {
        throw new Error(`Failed to apply visual editing changes: ${error}`);
      }
    },
  );

  ipcMain.handle(
    "analyze-component",
    async (_event, analyseComponentParams: AnalyseComponentParams) => {
      const { appId, componentId } = analyseComponentParams;
      try {
        const [filePath, lineStr] = componentId.split(":");
        const line = parseInt(lineStr, 10);

        if (!filePath || isNaN(line)) {
          return { isDynamic: false, hasStaticText: false, hasImage: false };
        }

        // Get the app to find its path
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error(`App not found: ${appId}`);
        }

        const appPath = getDyadAppPath(app.path);
        const fullPath = safeJoin(appPath, filePath);
        const content = await fsPromises.readFile(fullPath, "utf-8");
        return analyzeComponent(content, line);
      } catch (error) {
        console.error("Failed to analyze component:", error);
        return { isDynamic: false, hasStaticText: false, hasImage: false };
      }
    },
  );
}
