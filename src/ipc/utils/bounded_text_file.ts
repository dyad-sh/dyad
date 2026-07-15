import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export const APP_FILE_EDITOR_LIMIT_BYTES = 5 * 1024 * 1024;
export const AGENT_READ_FILE_RESULT_LIMIT_BYTES = 256 * 1024;

export const AGENT_READ_FILE_TRUNCATION_NOTICE =
  "\n\n[Output truncated at 256 KiB. Read a smaller range with start_line_one_indexed and end_line_one_indexed_inclusive.]";

const STREAM_CHUNK_BYTES = 64 * 1024;
const BINARY_SAMPLE_BYTES = 8 * 1024;
const AGENT_READ_FILE_CONTENT_LIMIT_BYTES =
  AGENT_READ_FILE_RESULT_LIMIT_BYTES -
  Buffer.byteLength(AGENT_READ_FILE_TRUNCATION_NOTICE, "utf8");

interface OpenContainedFileParams {
  rootPath: string;
  filePath: string;
  displayPath: string;
}

interface OpenContainedFileResult {
  handle: FileHandle;
  realPath: string;
  realRootPath: string;
  size: number;
}

interface ReadTextFileLinesParams extends OpenContainedFileParams {
  startLine?: number;
  endLineInclusive?: number;
  validateRealPath?: (realPath: string, realRootPath: string) => void;
}

interface ReadContainedTextFileParams extends OpenContainedFileParams {
  maxBytes: number;
  validateRealPath?: (realPath: string, realRootPath: string) => void;
}

export interface ReadTextFileLinesResult {
  content: string;
  truncated: boolean;
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

function isOutsideRoot(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

async function openContainedFile({
  rootPath,
  filePath,
  displayPath,
}: OpenContainedFileParams): Promise<OpenContainedFileResult> {
  const realRootPath = await fs.realpath(rootPath);
  let realPath: string;
  try {
    realPath = await fs.realpath(filePath);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      throw new DyadError(
        `File does not exist: ${displayPath}`,
        DyadErrorKind.NotFound,
      );
    }
    throw error;
  }

  if (isOutsideRoot(realRootPath, realPath)) {
    throw new DyadError(
      `Cannot read files outside the app: ${displayPath}`,
      DyadErrorKind.Precondition,
    );
  }

  const handle = await fs.open(realPath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new DyadError(
        `Path is not a file: ${displayPath}`,
        DyadErrorKind.Validation,
      );
    }
    return { handle, realPath, realRootPath, size: stat.size };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

function throwBinaryFileError(displayPath: string): never {
  throw new DyadError(
    `Cannot read binary file as UTF-8 text: ${displayPath}`,
    DyadErrorKind.Validation,
  );
}

function assertNoNullBytes(bytes: Uint8Array, displayPath: string): void {
  if (bytes.includes(0)) {
    throwBinaryFileError(displayPath);
  }
}

function decodeUtf8(bytes: Uint8Array, displayPath: string): string {
  assertNoNullBytes(bytes, displayPath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throwBinaryFileError(displayPath);
  }
}

export function boundAgentReadFileContent(content: string): {
  content: string;
  truncated: boolean;
} {
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length <= AGENT_READ_FILE_CONTENT_LIMIT_BYTES) {
    return { content, truncated: false };
  }

  let end = AGENT_READ_FILE_CONTENT_LIMIT_BYTES;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return {
    content: bytes.subarray(0, end).toString("utf8"),
    truncated: true,
  };
}

export async function readContainedTextFile({
  rootPath,
  filePath,
  displayPath,
  maxBytes,
  validateRealPath,
}: ReadContainedTextFileParams): Promise<string> {
  const opened = await openContainedFile({ rootPath, filePath, displayPath });
  try {
    validateRealPath?.(opened.realPath, opened.realRootPath);
    if (opened.size > maxBytes) {
      throw new DyadError(
        `File is too large to read safely: ${displayPath} (${opened.size} bytes; ${maxBytes} byte limit)`,
        DyadErrorKind.Validation,
      );
    }

    const buffer = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await opened.handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }

    const finalStat = await opened.handle.stat();
    if (finalStat.size !== opened.size) {
      throw new DyadError(
        `File changed while it was being read: ${displayPath}. Please try again.`,
        DyadErrorKind.Conflict,
      );
    }
    return decodeUtf8(buffer.subarray(0, offset), displayPath);
  } finally {
    await opened.handle.close();
  }
}

async function assertTextSample(
  handle: FileHandle,
  size: number,
  displayPath: string,
): Promise<void> {
  if (size === 0) return;
  const sample = Buffer.allocUnsafe(Math.min(size, BINARY_SAMPLE_BYTES));
  const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
  const bytes = sample.subarray(0, bytesRead);
  assertNoNullBytes(bytes, displayPath);
  try {
    // `stream: true` permits a valid multi-byte character to cross the sample
    // boundary while still rejecting malformed UTF-8 within the sample.
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
  } catch {
    throwBinaryFileError(displayPath);
  }
}

export async function readAppFileForEditor(
  params: OpenContainedFileParams,
): Promise<string> {
  const opened = await openContainedFile(params);
  try {
    if (opened.size > APP_FILE_EDITOR_LIMIT_BYTES) {
      throw new DyadError(
        `File is too large to open safely: ${params.displayPath} (${opened.size} bytes; ${APP_FILE_EDITOR_LIMIT_BYTES} byte limit)`,
        DyadErrorKind.Validation,
      );
    }

    const buffer = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await opened.handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }

    const finalStat = await opened.handle.stat();
    if (finalStat.size !== opened.size) {
      throw new DyadError(
        `File changed while it was being read: ${params.displayPath}. Please try again.`,
        DyadErrorKind.Conflict,
      );
    }

    return decodeUtf8(buffer.subarray(0, offset), params.displayPath);
  } finally {
    await opened.handle.close();
  }
}

export async function readTextFileLines({
  rootPath,
  filePath,
  displayPath,
  startLine = 1,
  endLineInclusive,
  validateRealPath,
}: ReadTextFileLinesParams): Promise<ReadTextFileLinesResult> {
  const opened = await openContainedFile({ rootPath, filePath, displayPath });
  try {
    validateRealPath?.(opened.realPath, opened.realRootPath);
    await assertTextSample(opened.handle, opened.size, displayPath);

    const output: string[] = [];
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const buffer = Buffer.allocUnsafe(STREAM_CHUNK_BYTES);
    let outputBytes = 0;
    let position = 0;
    let currentLine = 1;
    let truncated = false;
    let reachedRangeEnd = false;
    let pendingFinalNewline = false;

    const appendBytes = (bytes: Uint8Array): boolean => {
      if (bytes.byteLength === 0) return true;
      assertNoNullBytes(bytes, displayPath);
      const remaining = AGENT_READ_FILE_CONTENT_LIMIT_BYTES - outputBytes;
      if (remaining <= 0) {
        truncated = true;
        return false;
      }
      const selected = bytes.subarray(0, Math.min(bytes.byteLength, remaining));
      try {
        const decoded = decoder.decode(selected, { stream: true });
        if (decoded) output.push(decoded);
      } catch {
        throwBinaryFileError(displayPath);
      }
      outputBytes += selected.byteLength;
      if (selected.byteLength < bytes.byteLength) {
        truncated = true;
        return false;
      }
      return true;
    };

    while (!truncated && !reachedRangeEnd) {
      if (position >= opened.size) {
        if (pendingFinalNewline) {
          appendBytes(Buffer.from("\n"));
        }
        break;
      }
      const { bytesRead } = await opened.handle.read(
        buffer,
        0,
        Math.min(buffer.length, opened.size - position),
        position,
      );
      if (bytesRead === 0) {
        if (pendingFinalNewline) {
          appendBytes(Buffer.from("\n"));
        }
        break;
      }
      position += bytesRead;
      const chunk = buffer.subarray(0, bytesRead);

      if (pendingFinalNewline) {
        // A byte after the selected line proves its newline was not the file's
        // trailing newline, so omit it to preserve the legacy range behavior.
        reachedRangeEnd = true;
        break;
      }

      let offset = 0;
      while (offset < chunk.length && !truncated && !reachedRangeEnd) {
        const newlineIndex = chunk.indexOf(0x0a, offset);
        const hasNewline = newlineIndex !== -1;
        const segmentEnd = hasNewline ? newlineIndex + 1 : chunk.length;
        const inRange =
          currentLine >= startLine &&
          (endLineInclusive == null || currentLine <= endLineInclusive);

        if (inRange) {
          if (
            hasNewline &&
            endLineInclusive != null &&
            currentLine === endLineInclusive
          ) {
            if (!appendBytes(chunk.subarray(offset, newlineIndex))) break;
            pendingFinalNewline = true;
            if (segmentEnd < chunk.length) {
              pendingFinalNewline = false;
              reachedRangeEnd = true;
            }
          } else if (!appendBytes(chunk.subarray(offset, segmentEnd))) {
            break;
          }
        }

        offset = segmentEnd;
        if (!hasNewline) break;
        currentLine += 1;
      }
    }

    if (!truncated) {
      try {
        const final = decoder.decode();
        if (final) output.push(final);
      } catch {
        throwBinaryFileError(displayPath);
      }
    }

    return {
      content: output.join(""),
      truncated,
    };
  } finally {
    await opened.handle.close();
  }
}
