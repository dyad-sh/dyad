/**
 * Vault Zip Utilities
 * Handles project export/import as zip files with SHA256 hash calculation
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import * as os from "os";
import log from "electron-log";

const logger = log.scope("vault_zip");

// We'll use a simple approach without external zip libraries
// by creating a tar-like format or using Node's built-in zlib

/**
 * Calculate SHA256 hash of a file
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  const fileBuffer = await fs.readFile(filePath);
  const hash = crypto.createHash("sha256");
  hash.update(fileBuffer);
  return hash.digest("hex");
}

/**
 * Calculate SHA256 hash of a buffer
 */
export function calculateBufferHash(buffer: Buffer): string {
  const hash = crypto.createHash("sha256");
  hash.update(buffer);
  return hash.digest("hex");
}

/**
 * Get file size in bytes
 */
export async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size;
}

/**
 * Export project directory to a zip file
 * Returns the path to the created zip file and its SHA256 hash
 */
export async function exportProjectToZip(
  projectPath: string,
  outputPath: string
): Promise<{ zipPath: string; sha256: string; sizeBytes: number }> {
  logger.info(`Exporting project from ${projectPath} to ${outputPath}`);

  // Use zlib-based compression (always available in Node.js)
  // This creates a gzipped JSON archive format
  return exportFallback(projectPath, outputPath);
}

/**
 * Fallback export method using zlib (simpler, less efficient)
 */
async function exportFallback(
  projectPath: string,
  outputPath: string
): Promise<{ zipPath: string; sha256: string; sizeBytes: number }> {
  const zlib = await import("zlib");
  const { promisify } = await import("util");
  const gzip = promisify(zlib.gzip);

  // Collect all files into a JSON manifest + content
  const files: { path: string; content: string }[] = [];

  async function collectFiles(dir: string, basePath: string = "") {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(basePath, entry.name);

      // Skip common directories that shouldn't be backed up
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === ".vite" ||
        entry.name === "dist" ||
        entry.name === "out"
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        await collectFiles(fullPath, relativePath);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(fullPath, "base64");
          files.push({ path: relativePath, content });
        } catch (error) {
          logger.warn(`Failed to read file ${fullPath}:`, error);
        }
      }
    }
  }

  await collectFiles(projectPath);

  // Create manifest
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    files: files.map((f) => ({ path: f.path, size: f.content.length })),
  };

  // Combine into archive format
  const archiveData = JSON.stringify({ manifest, files });
  const compressed = await gzip(Buffer.from(archiveData));

  await fs.writeFile(outputPath, compressed);

  const sha256 = calculateBufferHash(compressed);
  const sizeBytes = compressed.length;

  return { zipPath: outputPath, sha256, sizeBytes };
}

/**
 * Import project from a zip file
 * Extracts the zip to the specified directory
 */
export async function importProjectFromZip(
  zipPath: string,
  targetPath: string,
  expectedSha256?: string
): Promise<void> {
  logger.info(`Importing project from ${zipPath} to ${targetPath}`);

  // Verify hash if provided
  if (expectedSha256) {
    const actualHash = await calculateFileHash(zipPath);
    if (actualHash !== expectedSha256) {
      throw new Error(
        `Hash mismatch: expected ${expectedSha256}, got ${actualHash}`
      );
    }
    logger.info("Hash verification passed");
  }

  // Use our gzipped JSON format
  return importFallback(zipPath, targetPath);
}

/**
 * Fallback import method for our custom format
 */
async function importFallback(
  zipPath: string,
  targetPath: string
): Promise<void> {
  const zlib = await import("zlib");
  const { promisify } = await import("util");
  const gunzip = promisify(zlib.gunzip);

  const compressed = await fs.readFile(zipPath);
  const decompressed = await gunzip(compressed);
  const archiveData = JSON.parse(decompressed.toString());

  await fs.mkdir(targetPath, { recursive: true });

  for (const file of archiveData.files) {
    const filePath = path.join(targetPath, file.path);
    const dirPath = path.dirname(filePath);

    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(filePath, Buffer.from(file.content, "base64"));
  }

  logger.info("Archive extracted successfully (fallback method)");
}

/**
 * Create a temporary file path for zip export
 */
export function getTempZipPath(projectName: string): string {
  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  const safeName = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .slice(0, 30);
  return path.join(tempDir, `abba-vault-${safeName}-${timestamp}.abba`);
}

/**
 * Clean up temporary zip file
 */
export async function cleanupTempZip(zipPath: string): Promise<void> {
  try {
    await fs.unlink(zipPath);
    logger.debug(`Cleaned up temp file: ${zipPath}`);
  } catch (error) {
    logger.warn(`Failed to cleanup temp file ${zipPath}:`, error);
  }
}
