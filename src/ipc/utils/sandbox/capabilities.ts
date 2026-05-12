import fs from "node:fs/promises";
import path from "node:path";
import { safeJoin } from "@/ipc/utils/path_utils";
import {
  getDyadMediaDir,
  listStoredAttachments,
  resolveAttachmentLogicalPath,
  toAttachmentLogicalPath,
} from "@/ipc/utils/media_path_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  SANDBOX_HOST_CALL_TIMEOUT_MS,
  SANDBOX_READ_FILE_LIMIT_BYTES,
} from "./limits";

type StructuredObject = { [key: string]: unknown };

export interface SandboxFileStats {
  size: number;
  isText: boolean;
  mtime: string;
}

export interface SandboxReadFileOptions {
  start?: number;
  length?: number;
  encoding?: "utf8" | "base64";
}

export type SandboxHostCallName = "read_file" | "list_files" | "file_stats";

export type SandboxHostCallObserver = (params: {
  name: SandboxHostCallName;
  path?: string;
}) => void;

const DENIED_PATH_PATTERNS = [
  /(^|[/\\])(?:\.env(?:\.[^/\\]+)*|\.envrc)(?:[/\\]|$)/i,
  /(^|[/\\])\.dyad([/\\]|$)/i,
  /(^|[/\\])\.git([/\\]|$)/i,
  /(^|[/\\])\.npmrc$/i,
  /(^|[/\\])\.yarnrc(?:\.yml)?$/i,
  /(^|[/\\])\.pypirc$/i,
  /(^|[/\\])\.(?:bash|zsh|fish|python|mysql|psql|sqlite)_history$/i,
  /(^|[/\\])node_modules([/\\]|$)/i,
  /(^|[/\\])\.ssh([/\\]|$)/i,
  /(^|[/\\])\.aws([/\\]|$)/i,
  /(^|[/\\])\.config([/\\]|$)/i,
  /(^|[/\\])\.netrc$/i,
  /\.key$/i,
  /\.pem$/i,
];

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".mjs",
  ".cjs",
  ".sql",
  ".svg",
  ".text",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

function isStructuredObject(value: unknown): value is StructuredObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNodeErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function parseOptionalNonNegativeInteger(
  value: unknown,
  name: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new DyadError(
      `read_file ${name} must be a non-negative integer.`,
      DyadErrorKind.Validation,
    );
  }
  return value;
}

function parseReadOptions(value: unknown): SandboxReadFileOptions {
  if (value == null) {
    return {};
  }
  if (!isStructuredObject(value)) {
    throw new DyadError(
      "read_file options must be an object.",
      DyadErrorKind.Validation,
    );
  }

  const start = value.start;
  const length = value.length;
  const encoding = value.encoding;

  if (encoding !== undefined && encoding !== "utf8" && encoding !== "base64") {
    throw new DyadError(
      "read_file encoding must be 'utf8' or 'base64'.",
      DyadErrorKind.Validation,
    );
  }

  return {
    start: parseOptionalNonNegativeInteger(start, "start"),
    length: parseOptionalNonNegativeInteger(length, "length"),
    encoding: encoding as "utf8" | "base64" | undefined,
  };
}

function assertAllowedGuestPath(guestPath: string): void {
  if (!guestPath || typeof guestPath !== "string") {
    throw new DyadError("File path is required.", DyadErrorKind.Validation);
  }
  if (path.isAbsolute(guestPath) || /^[A-Za-z]:[/\\]/.test(guestPath)) {
    throw new DyadError(
      "Absolute paths are not allowed in sandbox scripts.",
      DyadErrorKind.Validation,
    );
  }
  if (guestPath.startsWith("~/") || guestPath.startsWith("\\\\")) {
    throw new DyadError(
      "Home and UNC paths are not allowed in sandbox scripts.",
      DyadErrorKind.Validation,
    );
  }
  if (/(^|[/\\])\.\.([/\\]|$)/.test(guestPath)) {
    throw new DyadError(
      "Path traversal is not allowed in sandbox scripts.",
      DyadErrorKind.Validation,
    );
  }
  if (DENIED_PATH_PATTERNS.some((pattern) => pattern.test(guestPath))) {
    throw new DyadError(
      `Sandbox scripts cannot access protected path: ${guestPath}`,
      DyadErrorKind.Precondition,
    );
  }
}

function isTextPath(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function withHostCallTimeout<T>(
  description: string,
  fn: () => Promise<T>,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new DyadError(
              `${description} timed out after ${SANDBOX_HOST_CALL_TIMEOUT_MS}ms.`,
              DyadErrorKind.External,
            ),
          );
        }, SANDBOX_HOST_CALL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function resolveSandboxPath(params: {
  appPath: string;
  guestPath: string;
}): Promise<{ filePath: string; displayPath: string }> {
  if (params.guestPath.startsWith("attachments:")) {
    const attachment = await resolveAttachmentLogicalPath(
      params.appPath,
      params.guestPath,
    );
    if (!attachment) {
      throw new DyadError(
        `Attachment not found: ${params.guestPath}`,
        DyadErrorKind.NotFound,
      );
    }
    return {
      filePath: attachment.filePath,
      displayPath: toAttachmentLogicalPath(attachment.logicalName),
    };
  }

  assertAllowedGuestPath(params.guestPath);
  return {
    filePath: safeJoin(params.appPath, params.guestPath),
    displayPath: params.guestPath,
  };
}

async function assertResolvedPathAllowed(params: {
  appPath: string;
  filePath: string;
  displayPath: string;
}): Promise<void> {
  const realAppPath = await fs.realpath(params.appPath);
  let realFilePath: string;
  try {
    realFilePath = await fs.realpath(params.filePath);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      throw new DyadError(
        `File not found: ${params.displayPath}`,
        DyadErrorKind.NotFound,
      );
    }
    throw error;
  }
  const relative = path.relative(realAppPath, realFilePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new DyadError(
      `Sandbox scripts cannot access files outside the app: ${params.displayPath}`,
      DyadErrorKind.Precondition,
    );
  }
  if (params.displayPath.startsWith("attachments:")) {
    const realMediaPath = await fs.realpath(getDyadMediaDir(params.appPath));
    const mediaRelative = path.relative(realMediaPath, realFilePath);
    if (mediaRelative.startsWith("..") || path.isAbsolute(mediaRelative)) {
      throw new DyadError(
        `Sandbox scripts cannot access files outside attachment storage: ${params.displayPath}`,
        DyadErrorKind.Precondition,
      );
    }
    return;
  }
  const normalized = relative.split(path.sep).join("/");
  if (DENIED_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    throw new DyadError(
      `Sandbox scripts cannot access protected path: ${params.displayPath}`,
      DyadErrorKind.Precondition,
    );
  }
}

export async function sandboxReadFile(
  appPath: string,
  guestPath: string,
  rawOptions?: unknown,
): Promise<string> {
  return withHostCallTimeout("read_file", async () => {
    const options = parseReadOptions(rawOptions);
    const resolved = await resolveSandboxPath({ appPath, guestPath });
    await assertResolvedPathAllowed({ appPath, ...resolved });

    const stat = await fs.stat(resolved.filePath);
    if (!stat.isFile()) {
      throw new DyadError(
        `Path is not a file: ${resolved.displayPath}`,
        DyadErrorKind.Validation,
      );
    }

    const start = options.start ?? 0;
    if (
      options.length !== undefined &&
      options.length > SANDBOX_READ_FILE_LIMIT_BYTES
    ) {
      throw new DyadError(
        `read_file length ${options.length} exceeds the ${SANDBOX_READ_FILE_LIMIT_BYTES} byte limit. Read the file in chunks with start and length instead.`,
        DyadErrorKind.Validation,
      );
    }
    if (start > stat.size) {
      return "";
    }
    const remainingBytes = stat.size - start;
    const length = options.length ?? remainingBytes;
    if (length > SANDBOX_READ_FILE_LIMIT_BYTES) {
      throw new DyadError(
        `read_file would read ${length} bytes from ${resolved.displayPath}, exceeding the ${SANDBOX_READ_FILE_LIMIT_BYTES} byte limit. Use file_stats to get the size, then read bounded chunks with start and length.`,
        DyadErrorKind.Validation,
      );
    }

    const handle = await fs.open(resolved.filePath, "r");
    try {
      const bytesToRead = Math.min(length, remainingBytes);
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, start);
      const bytes = buffer.subarray(0, bytesRead);
      return (options.encoding ?? "utf8") === "base64"
        ? bytes.toString("base64")
        : bytes.toString("utf8");
    } finally {
      await handle.close();
    }
  });
}

export async function sandboxFileStats(
  appPath: string,
  guestPath: string,
): Promise<SandboxFileStats> {
  return withHostCallTimeout("file_stats", async () => {
    const resolved = await resolveSandboxPath({ appPath, guestPath });
    await assertResolvedPathAllowed({ appPath, ...resolved });
    const stat = await fs.stat(resolved.filePath);
    if (!stat.isFile()) {
      throw new DyadError(
        `Path is not a file: ${resolved.displayPath}`,
        DyadErrorKind.Validation,
      );
    }
    return {
      size: stat.size,
      isText: isTextPath(resolved.filePath),
      mtime: stat.mtime.toISOString(),
    };
  });
}

export async function sandboxListFiles(
  appPath: string,
  guestDir?: string,
): Promise<string[]> {
  return withHostCallTimeout("list_files", async () => {
    const dir = guestDir ?? ".";
    if (dir === "attachments:" || dir === "attachments") {
      const attachments = await listStoredAttachments(appPath);
      return attachments.map((attachment) =>
        toAttachmentLogicalPath(attachment.logicalName),
      );
    }

    assertAllowedGuestPath(dir);
    const dirPath = safeJoin(appPath, dir);
    const realAppPath = await fs.realpath(appPath);
    let realDirPath: string;
    try {
      realDirPath = await fs.realpath(dirPath);
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        throw new DyadError(
          `Directory not found: ${dir}`,
          DyadErrorKind.NotFound,
        );
      }
      throw error;
    }
    const relative = path.relative(realAppPath, realDirPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new DyadError(
        `Sandbox scripts cannot list files outside the app: ${dir}`,
        DyadErrorKind.Precondition,
      );
    }
    const entries = await fs.readdir(realDirPath, { withFileTypes: true });
    return entries
      .filter((entry) => !DENIED_PATH_PATTERNS.some((p) => p.test(entry.name)))
      .map((entry) => {
        const relativePath = path
          .join(relative, entry.name)
          .split(path.sep)
          .join("/");
        return entry.isDirectory() ? `${relativePath}/` : relativePath;
      })
      .sort();
  });
}

export function buildSandboxCapabilities(appPath: string) {
  return buildSandboxCapabilitiesWithObserver(appPath);
}

export function buildSandboxCapabilitiesWithObserver(
  appPath: string,
  onHostCall?: SandboxHostCallObserver,
) {
  return {
    read_file: (guestPath: unknown, options?: unknown) => {
      if (typeof guestPath !== "string") {
        throw new DyadError(
          "read_file path must be a string.",
          DyadErrorKind.Validation,
        );
      }
      onHostCall?.({ name: "read_file", path: guestPath });
      return sandboxReadFile(appPath, guestPath, options);
    },
    list_files: (dir?: unknown) => {
      if (dir !== undefined && typeof dir !== "string") {
        throw new DyadError(
          "list_files directory must be a string.",
          DyadErrorKind.Validation,
        );
      }
      onHostCall?.({ name: "list_files", path: dir });
      return sandboxListFiles(appPath, dir);
    },
    file_stats: (guestPath: unknown) => {
      if (typeof guestPath !== "string") {
        throw new DyadError(
          "file_stats path must be a string.",
          DyadErrorKind.Validation,
        );
      }
      onHostCall?.({ name: "file_stats", path: guestPath });
      return sandboxFileStats(appPath, guestPath);
    },
  };
}
