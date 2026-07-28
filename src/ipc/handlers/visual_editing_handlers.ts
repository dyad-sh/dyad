import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "path";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "@/paths/paths";
import { stylesToTailwind, extractClassPrefixes } from "@/utils/style-utils";
import { gitAdd, gitCommit, gitResetFile } from "@/ipc/utils/git_utils";
import { assertMutationPathAllowed, safeJoin } from "@/ipc/utils/path_utils";
import {
  VALID_IMAGE_MIME_TYPES,
  visualEditingContracts,
} from "@/ipc/types/visual-editing";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";
import { ensureDyadGitignored } from "@/ipc/handlers/gitignoreUtils";
import {
  transformContent,
  analyzeComponent,
} from "@/ipc/utils/visual_editing_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "@/ipc/handlers/base";
import { createAppMutationLock } from "@/ipc/utils/app_mutation_lock";

// Client allows 7.5 MB raw; base64 expands by ~4/3 plus data URL prefix
const MAX_IMAGE_SIZE = Math.ceil((7.5 * 1024 * 1024) / 3) * 4 + 100; // ~10,485,860

export function registerVisualEditingHandlers() {
  createTypedHandler(
    visualEditingContracts.applyChanges,
    createAppMutationLock(async (_event, params) => {
      const { appId, changes } = params;
      // Track written image files and staged git paths for cleanup on failure
      const writtenImagePaths: string[] = [];
      const stagedGitPaths: { appPath: string; filepath: string }[] = [];
      const commitFilepaths = new Set<string>();
      const originalFileContents: { filePath: string; content: string }[] = [];
      try {
        if (changes.length === 0) return;

        // Get the app to find its path
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new DyadError(
            `App not found: ${appId}`,
            DyadErrorKind.NotFound,
          );
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
          throw new DyadError(
            imageValidationErrors.length === 1
              ? imageValidationErrors[0]
              : `Multiple image issues:\n${imageValidationErrors.join("\n")}`,
            DyadErrorKind.Validation,
          );
        }

        // Write validated image files to public directory
        for (const change of changes) {
          if (change.imageUpload) {
            const { fileName, base64Data } = change.imageUpload;

            const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
            const finalFileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${sanitizedFileName}`;

            const buffer = Buffer.from(
              base64Data.replace(/^data:[^;]+;base64,/, ""),
              "base64",
            );

            // Save to .dyad/media as a staging copy
            const mediaRelativePath = await assertMutationPathAllowed({
              appPath,
              relativePath: path.join(DYAD_MEDIA_DIR_NAME, finalFileName),
            });
            const mediaPath = safeJoin(appPath, mediaRelativePath);
            const mediaDir = path.dirname(mediaPath);
            await fsPromises.mkdir(mediaDir, { recursive: true });
            await fsPromises.writeFile(mediaPath, buffer);
            writtenImagePaths.push(mediaPath);
            await ensureDyadGitignored(appPath);

            // Save to public/images for the app to serve
            const imageFilepath = await assertMutationPathAllowed({
              appPath,
              relativePath: path.join("public", "images", finalFileName),
            });
            const destPath = safeJoin(appPath, imageFilepath);
            const publicImagesDir = path.dirname(destPath);
            await fsPromises.mkdir(publicImagesDir, { recursive: true });
            await fsPromises.writeFile(destPath, buffer);
            writtenImagePaths.push(destPath);

            change.imageSrc = `/images/${finalFileName}`;

            if (fs.existsSync(path.join(appPath, ".git"))) {
              await gitAdd({
                path: appPath,
                filepath: imageFilepath,
              });
              stagedGitPaths.push({ appPath, filepath: imageFilepath });
              commitFilepaths.add(imageFilepath);
            }
          }
        }

        const fileChanges = new Map<
          string,
          Map<
            number | string,
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

          const location =
            change.columnNumber === undefined
              ? change.lineNumber
              : `${change.lineNumber}:${change.columnNumber}`;
          fileChanges.get(change.relativePath)!.set(location, {
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
          const normalizedRelativePath = await assertMutationPathAllowed({
            appPath,
            relativePath,
          });
          const filePath = safeJoin(appPath, normalizedRelativePath);
          const content = await fsPromises.readFile(filePath, "utf-8");
          const transformedContent = transformContent(content, lineChanges);
          originalFileContents.push({ filePath, content });
          await fsPromises.writeFile(filePath, transformedContent, "utf-8");
          if (fs.existsSync(path.join(appPath, ".git"))) {
            commitFilepaths.add(normalizedRelativePath);
          }
        }

        if (fileChanges.size > 0 && fs.existsSync(path.join(appPath, ".git"))) {
          await gitCommit({
            path: appPath,
            message: "Apply visual editing changes",
            paths: [...commitFilepaths],
          });
        }
      } catch (error) {
        // Unstage any image files that were git-added before the failure
        for (const { appPath, filepath } of stagedGitPaths) {
          try {
            await gitResetFile({ path: appPath, filepath });
          } catch {
            // Ignore cleanup errors
          }
        }
        // Clean up any image files written before the failure
        for (const filePath of writtenImagePaths) {
          try {
            await fsPromises.unlink(filePath);
          } catch {
            // Ignore cleanup errors
          }
        }
        for (const { filePath, content } of originalFileContents) {
          try {
            await fsPromises.writeFile(filePath, content, "utf-8");
          } catch {
            // Ignore cleanup errors
          }
        }
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(String(error));
      }
    }),
  );

  createTypedHandler(
    visualEditingContracts.analyzeComponent,
    async (_event, analyseComponentParams) => {
      const { appId, componentId } = analyseComponentParams;
      try {
        const locationParts = componentId.split(":");
        const columnStr = locationParts.pop();
        const lineStr = locationParts.pop();
        const filePath = locationParts.join(":");
        const line = lineStr ? parseInt(lineStr, 10) : NaN;
        const column = columnStr ? parseInt(columnStr, 10) : NaN;

        if (!filePath || isNaN(line) || isNaN(column)) {
          return { isDynamic: false, hasStaticText: false, hasImage: false };
        }

        // Get the app to find its path
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new DyadError(
            `App not found: ${appId}`,
            DyadErrorKind.NotFound,
          );
        }

        const appPath = getDyadAppPath(app.path);
        const fullPath = safeJoin(appPath, filePath);
        const content = await fsPromises.readFile(fullPath, "utf-8");
        return analyzeComponent(content, line, column);
      } catch (error) {
        console.error("Failed to analyze component:", error);
        return { isDynamic: false, hasStaticText: false, hasImage: false };
      }
    },
  );
}
