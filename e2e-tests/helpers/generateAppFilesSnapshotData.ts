import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface FileSnapshotData {
  relativePath: string;
  content: string;
}

const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".tiff",
  ".psd",
  ".raw",
  ".bmp",
  ".heif",
  ".ico",
  ".pdf",
  ".eot",
  ".otf",
  ".ttf",
  ".woff",
  ".woff2",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".mov",
  ".mp4",
  ".m4v",
  ".mkv",
  ".webm",
  ".flv",
  ".avi",
  ".wmv",
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".exe",
  ".dll",
  ".so",
  ".a",
  ".lib",
  ".o",
  ".db",
  ".sqlite3",
  ".wasm",
]);

function isBinaryFile(filePath: string): boolean {
  return binaryExtensions.has(path.extname(filePath).toLowerCase());
}

export function generateAppFilesSnapshotData(
  currentPath: string,
  basePath: string,
): FileSnapshotData[] {
  const ignorePatterns = [
    ".DS_Store",
    ".git",
    "node_modules",
    // Avoid snapshotting lock files because they are getting generated
    // automatically and cause noise, and not super important anyways.
    "package-lock.json",
    "pnpm-lock.yaml",
  ];

  const entries = fs.readdirSync(currentPath, { withFileTypes: true });
  let files: FileSnapshotData[] = [];

  // Sort entries for deterministic order
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);
    if (ignorePatterns.includes(entry.name)) {
      continue;
    }

    if (entry.isDirectory()) {
      files = files.concat(generateAppFilesSnapshotData(entryPath, basePath));
    } else if (entry.isFile()) {
      const relativePath = path
        .relative(basePath, entryPath)
        // Normalize path separators to always use /
        // to prevent diffs on Windows.
        .replace(/\\/g, "/");
      try {
        if (isBinaryFile(entryPath)) {
          const fileBuffer = fs.readFileSync(entryPath);
          const hash = crypto
            .createHash("sha256")
            .update(fileBuffer)
            .digest("hex");
          files.push({
            relativePath,
            content: `[binary hash="${hash}"]`,
          });
          continue;
        }

        let content = fs
          .readFileSync(entryPath, "utf-8")
          // Normalize line endings to always use \n
          .replace(/\r\n/g, "\n");
        if (entry.name === "package.json") {
          const packageJson = JSON.parse(content);
          packageJson.packageManager = "<scrubbed>";
          for (const key in packageJson.dependencies) {
            if (key.startsWith("@capacitor/")) {
              packageJson.dependencies[key] = "<scrubbed>";
            }
          }
          content = JSON.stringify(packageJson, null, 2);
        }
        files.push({ relativePath, content });
      } catch (error) {
        // Could be a binary file or permission issue, log and add a placeholder
        const e = error as Error;
        console.warn(`Could not read file ${entryPath}: ${e.message}`);
        files.push({
          relativePath,
          content: `[Error reading file: ${e.message}]`,
        });
      }
    }
  }
  return files;
}
