import { promisify } from "node:util";
import zlib from "node:zlib";

const inflateRaw = promisify(zlib.inflateRaw);

/**
 * Minimal in-memory ZIP container reader.
 *
 * Dyad accepts archives only as chat attachments, which are capped at a few
 * MiB, so the whole archive is held in one Buffer and parsed from the central
 * directory. Decompression is delegated to Node's zlib; this module only
 * understands the container format (PKWARE APPNOTE 6.3.x):
 *
 * - End of central directory record, with the trailing comment scanned back
 *   over, and the ZIP64 locator/record when any 32-bit field is saturated.
 * - Central directory file headers, including the ZIP64 extended information
 *   extra field and the Info-ZIP Unicode Path extra field.
 * - Local file headers only to locate entry data (their lengths may differ
 *   from the central directory's when a writer streamed the archive and used
 *   data descriptors, so sizes always come from the central directory).
 * - Entry names in UTF-8 (general purpose bit 11) or CP437.
 *
 * Supported compression methods are "stored" (0) and "deflate" (8). Every
 * other method, and every encrypted entry, is reported on the entry so the
 * caller can skip it with a reason. Multi-disk archives are rejected.
 *
 * The reader never trusts a length or offset it has not bounds-checked, and
 * every loop is bounded by the entry count declared in the (also bounded)
 * central directory, so a malformed archive produces a `ZipFormatError`
 * rather than a hang or an oversized allocation.
 */

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipFormatError";
  }
}

/** The archive is well formed but exceeds a caller-supplied limit. */
export class ZipLimitError extends Error {
  constructor(
    message: string,
    /**
     * "entries" counts the files to extract; "directory" counts every entry
     * the archive declares, including folders and skipped ones.
     */
    public readonly limit: "entries" | "bytes" | "directory",
  ) {
    super(message);
    this.name = "ZipLimitError";
  }
}

export const ZIP_COMPRESSION_STORED = 0;
export const ZIP_COMPRESSION_DEFLATE = 8;

export interface ZipEntry {
  /** Entry name as stored in the archive, decoded, with the original separators. */
  name: string;
  /** Directory entries end with "/" or carry the MS-DOS directory attribute. */
  isDirectory: boolean;
  /** Unix symlink according to the external attributes of a Unix-made entry. */
  isSymlink: boolean;
  /** Unix-made entry with any execute bit set in its external attributes. */
  isExecutable: boolean;
  /** Traditional PKWARE or strong encryption is flagged; data cannot be read. */
  isEncrypted: boolean;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  /** Absolute offset of the local file header within the archive. */
  localHeaderOffset: number;
}

export interface ReadZipDirectoryOptions {
  /**
   * Reject archives whose central directory declares more entries than this
   * with a `ZipLimitError`, before any header is parsed.
   */
  maxEntries?: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_COMMENT_LENGTH = 0xffff;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_LOCATOR_SIZE = 20;
const ZIP64_EOCD_RECORD_SIGNATURE = 0x06064b50;
const ZIP64_EOCD_RECORD_MIN_SIZE = 56;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;

const EXTRA_FIELD_ZIP64 = 0x0001;
const EXTRA_FIELD_UNICODE_PATH = 0x7075;

const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8_NAMES = 0x0800;

const MSDOS_DIRECTORY_ATTRIBUTE = 0x10;
const HOST_SYSTEM_UNIX = 3;
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_FILE_TYPE_SYMLINK = 0xa000;

const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

// Code page 437 (the original IBM PC character set) for 0x80..0xFF. Archives
// written without the UTF-8 flag by older Windows tools use it for names.
const CP437_HIGH_HALF =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

function decodeCp437(bytes: Buffer): string {
  let out = "";
  for (const byte of bytes) {
    out +=
      byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH_HALF[byte - 0x80];
  }
  return out;
}

function decodeEntryName(bytes: Buffer, flags: number): string {
  if (flags & FLAG_UTF8_NAMES) {
    return bytes.toString("utf8");
  }
  for (const byte of bytes) {
    if (byte >= 0x80) {
      return decodeCp437(bytes);
    }
  }
  return bytes.toString("latin1");
}

function readUint64(buffer: Buffer, offset: number, what: string): number {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipFormatError(`${what} is too large`);
  }
  return Number(value);
}

function assertRange(
  buffer: Buffer,
  offset: number,
  length: number,
  what: string,
): void {
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > buffer.length
  ) {
    throw new ZipFormatError(`${what} lies outside the archive`);
  }
}

interface EndOfCentralDirectory {
  totalEntries: number;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
}

function findEndOfCentralDirectory(buffer: Buffer): EndOfCentralDirectory {
  if (buffer.length < EOCD_MIN_SIZE) {
    throw new ZipFormatError("file is too small to be a zip archive");
  }
  const lowestStart = Math.max(
    0,
    buffer.length - EOCD_MIN_SIZE - EOCD_MAX_COMMENT_LENGTH,
  );
  // Prefer the record whose declared comment ends exactly at the end of the
  // file; the signature bytes can also occur inside a comment. Fall back to
  // the last record that fits, so archives with trailing junk still open.
  let eocdOffset = -1;
  let fallbackOffset = -1;
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= lowestStart; i--) {
    if (buffer.readUInt32LE(i) !== EOCD_SIGNATURE) {
      continue;
    }
    const recordEnd = i + EOCD_MIN_SIZE + buffer.readUInt16LE(i + 20);
    if (recordEnd === buffer.length) {
      eocdOffset = i;
      break;
    }
    if (recordEnd < buffer.length && fallbackOffset === -1) {
      fallbackOffset = i;
    }
  }
  if (eocdOffset === -1) {
    eocdOffset = fallbackOffset;
  }
  if (eocdOffset === -1) {
    throw new ZipFormatError("end of central directory record not found");
  }

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(eocdOffset + 6);
  let totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  let centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);

  const needsZip64 =
    totalEntries === UINT16_MAX ||
    centralDirectorySize === UINT32_MAX ||
    centralDirectoryOffset === UINT32_MAX ||
    diskNumber === UINT16_MAX;

  if (needsZip64) {
    const locatorOffset = eocdOffset - ZIP64_EOCD_LOCATOR_SIZE;
    if (
      locatorOffset < 0 ||
      buffer.readUInt32LE(locatorOffset) !== ZIP64_EOCD_LOCATOR_SIGNATURE
    ) {
      throw new ZipFormatError(
        "ZIP64 end of central directory locator not found",
      );
    }
    const totalDisks = buffer.readUInt32LE(locatorOffset + 16);
    if (totalDisks > 1) {
      throw new ZipFormatError("multi-disk archives are not supported");
    }
    const recordOffset = readUint64(
      buffer,
      locatorOffset + 8,
      "ZIP64 end of central directory offset",
    );
    assertRange(
      buffer,
      recordOffset,
      ZIP64_EOCD_RECORD_MIN_SIZE,
      "ZIP64 end of central directory record",
    );
    if (buffer.readUInt32LE(recordOffset) !== ZIP64_EOCD_RECORD_SIGNATURE) {
      throw new ZipFormatError(
        "ZIP64 end of central directory record not found",
      );
    }
    const recordDisk = buffer.readUInt32LE(recordOffset + 16);
    const recordCentralDirectoryDisk = buffer.readUInt32LE(recordOffset + 20);
    if (recordDisk !== 0 || recordCentralDirectoryDisk !== 0) {
      throw new ZipFormatError("multi-disk archives are not supported");
    }
    totalEntries = readUint64(buffer, recordOffset + 32, "entry count");
    centralDirectorySize = readUint64(
      buffer,
      recordOffset + 40,
      "central directory size",
    );
    centralDirectoryOffset = readUint64(
      buffer,
      recordOffset + 48,
      "central directory offset",
    );
  } else if (diskNumber !== 0 || centralDirectoryDisk !== 0) {
    throw new ZipFormatError("multi-disk archives are not supported");
  }

  assertRange(
    buffer,
    centralDirectoryOffset,
    centralDirectorySize,
    "central directory",
  );
  return { totalEntries, centralDirectoryOffset, centralDirectorySize };
}

interface Zip64ExtraValues {
  uncompressedSize?: number;
  compressedSize?: number;
  localHeaderOffset?: number;
}

function parseZip64Extra(
  data: Buffer,
  saturated: {
    uncompressedSize: boolean;
    compressedSize: boolean;
    localHeaderOffset: boolean;
  },
): Zip64ExtraValues {
  // The extra field only carries the values whose 32-bit counterparts are
  // saturated, in this fixed order.
  const values: Zip64ExtraValues = {};
  let offset = 0;
  const take = (what: string): number => {
    if (offset + 8 > data.length) {
      throw new ZipFormatError(`ZIP64 extra field is missing ${what}`);
    }
    const value = readUint64(data, offset, what);
    offset += 8;
    return value;
  };
  if (saturated.uncompressedSize) {
    values.uncompressedSize = take("uncompressed size");
  }
  if (saturated.compressedSize) {
    values.compressedSize = take("compressed size");
  }
  if (saturated.localHeaderOffset) {
    values.localHeaderOffset = take("local header offset");
  }
  return values;
}

function parseUnicodePathExtra(data: Buffer, rawName: Buffer): string | null {
  // Version byte, CRC-32 of the raw name, then the UTF-8 name. The CRC guards
  // against a stale field left behind by a tool that renamed the entry.
  if (data.length < 5 || data[0] !== 1) {
    return null;
  }
  if (data.readUInt32LE(1) !== zlib.crc32(rawName)) {
    return null;
  }
  return data.subarray(5).toString("utf8");
}

function readCentralHeader(
  buffer: Buffer,
  offset: number,
): { entry: ZipEntry; nextOffset: number } {
  assertRange(buffer, offset, CENTRAL_HEADER_SIZE, "central directory header");
  if (buffer.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE) {
    throw new ZipFormatError("central directory header signature mismatch");
  }
  const versionMadeBy = buffer.readUInt16LE(offset + 4);
  const flags = buffer.readUInt16LE(offset + 8);
  const compressionMethod = buffer.readUInt16LE(offset + 10);
  const crc32 = buffer.readUInt32LE(offset + 16);
  let compressedSize = buffer.readUInt32LE(offset + 20);
  let uncompressedSize = buffer.readUInt32LE(offset + 24);
  const nameLength = buffer.readUInt16LE(offset + 28);
  const extraLength = buffer.readUInt16LE(offset + 30);
  const commentLength = buffer.readUInt16LE(offset + 32);
  const externalAttributes = buffer.readUInt32LE(offset + 38);
  let localHeaderOffset = buffer.readUInt32LE(offset + 42);

  const nameOffset = offset + CENTRAL_HEADER_SIZE;
  const extraOffset = nameOffset + nameLength;
  const commentOffset = extraOffset + extraLength;
  const nextOffset = commentOffset + commentLength;
  assertRange(
    buffer,
    nameOffset,
    nextOffset - nameOffset,
    "central directory entry",
  );

  const rawName = buffer.subarray(nameOffset, extraOffset);
  let name = decodeEntryName(rawName, flags);

  const saturated = {
    uncompressedSize: uncompressedSize === UINT32_MAX,
    compressedSize: compressedSize === UINT32_MAX,
    localHeaderOffset: localHeaderOffset === UINT32_MAX,
  };
  let extraCursor = extraOffset;
  while (extraCursor + 4 <= commentOffset) {
    const fieldId = buffer.readUInt16LE(extraCursor);
    const fieldSize = buffer.readUInt16LE(extraCursor + 2);
    const fieldStart = extraCursor + 4;
    const fieldEnd = fieldStart + fieldSize;
    if (fieldEnd > commentOffset) {
      // A truncated trailing extra field is tolerated; it is ignored.
      break;
    }
    const fieldData = buffer.subarray(fieldStart, fieldEnd);
    if (fieldId === EXTRA_FIELD_ZIP64) {
      const values = parseZip64Extra(fieldData, saturated);
      uncompressedSize = values.uncompressedSize ?? uncompressedSize;
      compressedSize = values.compressedSize ?? compressedSize;
      localHeaderOffset = values.localHeaderOffset ?? localHeaderOffset;
    } else if (fieldId === EXTRA_FIELD_UNICODE_PATH) {
      name = parseUnicodePathExtra(fieldData, rawName) ?? name;
    }
    extraCursor = fieldEnd;
  }

  const hostSystem = versionMadeBy >> 8;
  const unixMode =
    hostSystem === HOST_SYSTEM_UNIX ? externalAttributes >>> 16 : null;
  const isSymlink =
    unixMode !== null &&
    (unixMode & UNIX_FILE_TYPE_MASK) === UNIX_FILE_TYPE_SYMLINK;
  const isExecutable = unixMode !== null && (unixMode & 0o111) !== 0;
  const isDirectory =
    name.endsWith("/") ||
    name.endsWith("\\") ||
    (externalAttributes & MSDOS_DIRECTORY_ATTRIBUTE) !== 0;

  return {
    entry: {
      name,
      isDirectory,
      isSymlink,
      isExecutable,
      isEncrypted: (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      crc32,
      localHeaderOffset,
    },
    nextOffset,
  };
}

/**
 * Parse the archive's central directory into entries, without touching entry
 * data. Throws `ZipFormatError` for anything that is not a readable archive.
 */
export function readZipDirectory(
  buffer: Buffer,
  options: ReadZipDirectoryOptions = {},
): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  if (
    options.maxEntries !== undefined &&
    eocd.totalEntries > options.maxEntries
  ) {
    throw new ZipLimitError(
      `archive declares ${eocd.totalEntries} entries, more than the ${options.maxEntries} allowed`,
      "entries",
    );
  }
  // Each header is at least CENTRAL_HEADER_SIZE bytes, so a count the archive
  // cannot physically hold is rejected before the walk starts.
  if (eocd.totalEntries * CENTRAL_HEADER_SIZE > eocd.centralDirectorySize) {
    throw new ZipFormatError(
      "central directory is smaller than its entry count implies",
    );
  }

  const entries: ZipEntry[] = [];
  let offset = eocd.centralDirectoryOffset;
  for (let i = 0; i < eocd.totalEntries; i++) {
    const { entry, nextOffset } = readCentralHeader(buffer, offset);
    entries.push(entry);
    offset = nextOffset;
  }
  return entries;
}

export function isSupportedZipCompression(entry: ZipEntry): boolean {
  return (
    entry.compressionMethod === ZIP_COMPRESSION_STORED ||
    entry.compressionMethod === ZIP_COMPRESSION_DEFLATE
  );
}

/**
 * Decompress one entry's data. Inflation runs on zlib's thread pool so the
 * main thread is not blocked by large entries. The output is bounded by the
 * entry's declared uncompressed size (zlib stops inflating past it), and the
 * CRC-32 recorded in the central directory must match, so a corrupted or
 * lying entry fails instead of producing garbage.
 */
export async function readZipEntryData(
  buffer: Buffer,
  entry: ZipEntry,
): Promise<Buffer> {
  if (entry.isEncrypted) {
    throw new ZipFormatError(`entry "${entry.name}" is encrypted`);
  }
  if (!isSupportedZipCompression(entry)) {
    throw new ZipFormatError(
      `entry "${entry.name}" uses unsupported compression method ${entry.compressionMethod}`,
    );
  }

  const headerOffset = entry.localHeaderOffset;
  assertRange(
    buffer,
    headerOffset,
    LOCAL_HEADER_SIZE,
    `local header of "${entry.name}"`,
  );
  if (buffer.readUInt32LE(headerOffset) !== LOCAL_HEADER_SIGNATURE) {
    throw new ZipFormatError(
      `local header signature mismatch for "${entry.name}"`,
    );
  }
  // The local header's own name and extra lengths locate the data; they can
  // legitimately differ from the central directory's (for example when the
  // writer added a ZIP64 extra field to only one of them).
  const nameLength = buffer.readUInt16LE(headerOffset + 26);
  const extraLength = buffer.readUInt16LE(headerOffset + 28);
  const dataOffset =
    headerOffset + LOCAL_HEADER_SIZE + nameLength + extraLength;
  assertRange(
    buffer,
    dataOffset,
    entry.compressedSize,
    `data of "${entry.name}"`,
  );
  const compressed = buffer.subarray(
    dataOffset,
    dataOffset + entry.compressedSize,
  );

  let data: Buffer;
  if (entry.compressionMethod === ZIP_COMPRESSION_STORED) {
    data = Buffer.from(compressed);
  } else {
    try {
      // zlib requires a positive output limit; an entry declared empty is
      // still inflated so a non-empty stream fails the size check below.
      data = await inflateRaw(compressed, {
        maxOutputLength: Math.max(1, entry.uncompressedSize),
      });
    } catch (error) {
      throw new ZipFormatError(
        `entry "${entry.name}" could not be decompressed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (data.length !== entry.uncompressedSize) {
    throw new ZipFormatError(
      `entry "${entry.name}" decompressed to ${data.length} bytes, expected ${entry.uncompressedSize}`,
    );
  }
  if (zlib.crc32(data) !== entry.crc32) {
    throw new ZipFormatError(`entry "${entry.name}" failed its CRC-32 check`);
  }
  return data;
}
