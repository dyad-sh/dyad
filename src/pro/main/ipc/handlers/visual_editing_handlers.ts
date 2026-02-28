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
import { VALID_IMAGE_MIME_TYPES } from "@/ipc/types/visual-editing";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";
import { ensureDyadGitignored } from "@/ipc/handlers/gitignoreUtils";
import {
  transformContent,
  analyzeComponent,
} from "../../utils/visual_editing_utils";
import { normalizePath } from "../../../../../shared/normalizePath";

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

        // Validate all image uploads upfront before making any changes
        const imageValidationErrors: string[] = [];
        for (const change of changes) {
          if (change.imageUpload) {
            const { fileName, base64Data, mimeType } = change.imageUpload;

            if (
              !(VALID_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)
            ) {
              imageValidationErrors.push(
                `"${fileName}": Unsupported image type (${mimeType}). Allowed types: JPEG, PNG, GIF, WebP.`,
              );
            }

            if (base64Data.length > MAX_IMAGE_SIZE) {
              imageValidationErrors.push(
                `"${fileName}": The image is too large (max 7.5 MB). Please choose a smaller file.`,
              );
            }
          }
        }

        if (imageValidationErrors.length > 0) {
          throw new Error(
            imageValidationErrors.length === 1
              ? imageValidationErrors[0]
              : `Multiple image issues:\n${imageValidationErrors.join("\n")}`,
          );
        }

        // Write validated image files to public directory
        for (const change of changes) {
          if (change.imageUpload) {
            const { fileName, base64Data } = change.imageUpload;

            const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
            const timestamp = Date.now();
            const finalFileName = `${timestamp}-${sanitizedFileName}`;

            const buffer = Buffer.from(
              base64Data.replace(/^data:[^;]+;base64,/, ""),
              "base64",
            );

            // Save to .dyad/media as a staging copy
            const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
            await fsPromises.mkdir(mediaDir, { recursive: true });
            await fsPromises.writeFile(
              path.join(mediaDir, finalFileName),
              buffer,
            );
            await ensureDyadGitignored(appPath);

            // Save to public/images for the app to serve
            const publicImagesDir = path.join(appPath, "public", "images");
            await fsPromises.mkdir(publicImagesDir, { recursive: true });
            const destPath = path.join(publicImagesDir, finalFileName);
            await fsPromises.writeFile(destPath, buffer);

            change.imageSrc = `/images/${finalFileName}`;

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
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(String(error));
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
