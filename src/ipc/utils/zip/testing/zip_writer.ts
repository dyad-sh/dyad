import zlib from "node:zlib";

/**
 * Test-only ZIP writer. It exists so reader and extractor tests can build
 * archives with precisely controlled headers, including the malformed ones a
 * real tool would never emit (traversal names, lying sizes, symlink entries,
 * unsupported methods). Real-tool archives live in `__fixtures__/`.
 */

export interface ZipWriterEntry {
  name: string;
  data?: Buffer | string;
  /** Default: deflate for non-empty data, stored for empty data. */
  method?: number;
  /** Mark the entry as a directory (name gets a trailing slash if missing). */
  directory?: boolean;
  /** Set general purpose bit 11 so the name is declared UTF-8. Default: true. */
  utf8?: boolean;
  /** Set the encryption flag without encrypting anything. */
  encrypted?: boolean;
  /** Set bit 3 and zero the sizes/CRC in the local header, like a streaming writer. */
  dataDescriptor?: boolean;
  /** Unix mode written into the external attributes (also sets host = Unix). */
  unixMode?: number;
  /** Override the uncompressed size recorded in the central directory. */
  declaredUncompressedSize?: number;
  /** Override the CRC-32 recorded in the central directory. */
  declaredCrc32?: number;
  /** Write a ZIP64 extra field carrying the sizes and offset. */
  zip64?: boolean;
  /** Override the central-directory name bytes (for CP437 and other encodings). */
  rawName?: Buffer;
  /** Append an Info-ZIP Unicode Path extra field with this UTF-8 name. */
  unicodePathName?: string;
}

export interface ZipWriterOptions {
  comment?: string;
  /** Force a ZIP64 end-of-central-directory record and locator. */
  zip64?: boolean;
  /** Bytes to place before the first local header (self-extractor stub). */
  prefix?: Buffer;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

function u16(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
}

function u32(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return b;
}

function u64(value: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}

export function buildZip(
  entries: ZipWriterEntry[],
  options: ZipWriterOptions = {},
): Buffer {
  const parts: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;
  if (options.prefix) {
    parts.push(options.prefix);
    offset += options.prefix.length;
  }

  for (const entry of entries) {
    if (entry.zip64 && entry.dataDescriptor) {
      throw new Error(
        "zip64 data descriptors are not supported by this writer",
      );
    }
    const isDirectory = entry.directory ?? false;
    const name =
      isDirectory && !entry.name.endsWith("/") ? `${entry.name}/` : entry.name;
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data ?? "", "utf8");
    const method = entry.method ?? (data.length === 0 ? 0 : 8);
    const compressed =
      method === 8
        ? zlib.deflateRawSync(data)
        : method === 0
          ? data
          : // Unsupported methods carry opaque bytes; the reader must not inflate them.
            data;
    const crc = entry.declaredCrc32 ?? zlib.crc32(data);
    const uncompressedSize = entry.declaredUncompressedSize ?? data.length;

    let flags = 0;
    if (entry.utf8 ?? true) flags |= 0x0800;
    if (entry.encrypted) flags |= 0x0001;
    if (entry.dataDescriptor) flags |= 0x0008;

    const nameBytes = entry.rawName ?? Buffer.from(name, "utf8");
    const localExtra: Buffer[] = [];
    const centralExtra: Buffer[] = [];
    if (entry.zip64) {
      const body = Buffer.concat([
        u64(uncompressedSize),
        u64(compressed.length),
        u64(offset),
      ]);
      centralExtra.push(u16(0x0001), u16(body.length), body);
      // Local headers typically carry only the two sizes.
      const localBody = Buffer.concat([
        u64(uncompressedSize),
        u64(compressed.length),
      ]);
      localExtra.push(u16(0x0001), u16(localBody.length), localBody);
    }
    if (entry.unicodePathName !== undefined) {
      const utf8Name = Buffer.from(entry.unicodePathName, "utf8");
      const body = Buffer.concat([
        Buffer.from([1]),
        u32(zlib.crc32(nameBytes)),
        utf8Name,
      ]);
      centralExtra.push(u16(0x7075), u16(body.length), body);
    }
    const localExtraBytes = Buffer.concat(localExtra);
    const centralExtraBytes = Buffer.concat(centralExtra);

    const localCrc = entry.dataDescriptor ? 0 : crc;
    const localCompressedSize = entry.dataDescriptor
      ? 0
      : entry.zip64
        ? 0xffffffff
        : compressed.length;
    const localUncompressedSize = entry.dataDescriptor
      ? 0
      : entry.zip64
        ? 0xffffffff
        : uncompressedSize;

    const localHeader = Buffer.concat([
      u32(LOCAL_SIG),
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0),
      u32(localCrc),
      u32(localCompressedSize),
      u32(localUncompressedSize),
      u16(nameBytes.length),
      u16(localExtraBytes.length),
      nameBytes,
      localExtraBytes,
    ]);
    const localOffset = offset;
    parts.push(localHeader, compressed);
    offset += localHeader.length + compressed.length;
    if (entry.dataDescriptor) {
      const descriptor = Buffer.concat([
        u32(0x08074b50),
        u32(crc),
        u32(compressed.length),
        u32(uncompressedSize),
      ]);
      parts.push(descriptor);
      offset += descriptor.length;
    }

    const hostSystem = entry.unixMode !== undefined ? 3 : 0;
    const externalAttributes =
      (entry.unixMode !== undefined ? (entry.unixMode & 0xffff) * 0x10000 : 0) +
      (isDirectory ? 0x10 : 0);
    centralHeaders.push(
      Buffer.concat([
        u32(CENTRAL_SIG),
        u16((hostSystem << 8) | 20),
        u16(20),
        u16(flags),
        u16(method),
        u16(0),
        u16(0),
        u32(crc),
        u32(entry.zip64 ? 0xffffffff : compressed.length),
        u32(entry.zip64 ? 0xffffffff : uncompressedSize),
        u16(nameBytes.length),
        u16(centralExtraBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u32(externalAttributes >>> 0),
        u32(entry.zip64 ? 0xffffffff : localOffset),
        nameBytes,
        centralExtraBytes,
      ]),
    );
  }

  const centralDirectoryOffset = offset;
  const centralDirectory = Buffer.concat(centralHeaders);
  parts.push(centralDirectory);
  offset += centralDirectory.length;

  const comment = Buffer.from(options.comment ?? "", "utf8");
  if (options.zip64) {
    const zip64Record = Buffer.concat([
      u32(ZIP64_EOCD_SIG),
      u64(44),
      u16(45),
      u16(45),
      u32(0),
      u32(0),
      u64(entries.length),
      u64(entries.length),
      u64(centralDirectory.length),
      u64(centralDirectoryOffset),
    ]);
    const locator = Buffer.concat([
      u32(ZIP64_LOCATOR_SIG),
      u32(0),
      u64(offset),
      u32(1),
    ]);
    parts.push(zip64Record, locator);
    parts.push(
      Buffer.concat([
        u32(EOCD_SIG),
        u16(0),
        u16(0),
        u16(0xffff),
        u16(0xffff),
        u32(0xffffffff),
        u32(0xffffffff),
        u16(comment.length),
        comment,
      ]),
    );
  } else {
    parts.push(
      Buffer.concat([
        u32(EOCD_SIG),
        u16(0),
        u16(0),
        u16(entries.length),
        u16(entries.length),
        u32(centralDirectory.length),
        u32(centralDirectoryOffset),
        u16(comment.length),
        comment,
      ]),
    );
  }

  return Buffer.concat(parts);
}
