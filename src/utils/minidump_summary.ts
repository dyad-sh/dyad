import fs from "node:fs";

// A small, symbol-free summary extracted from a minidump: enough to attribute a
// native crash (which signal, which module faulted) without any memory contents,
// so it is safe to send as telemetry. Not a full stack walk — just the faulting
// frame's module + offset, which can be resolved to a function name offline
// against public symbols using the recorded app/Electron version.
export interface MinidumpSummary {
  crashReason?: string; // e.g. "SIGABRT" / "SIGSEGV" (POSIX) or NTSTATUS name
  exceptionCode: number; // raw code, in case the name table misses it
  faultingModule?: string; // basename of the module containing the crash address
  faultingOffset?: string; // hex offset of the crash address within that module
  ptype?: string; // crashing process type: "browser" (main) / "renderer" / "gpu-process" / …
}

// These values are fixed by the minidump file format. The signature and stream
// type ids come from Microsoft's MINIDUMP_HEADER / MINIDUMP_STREAM_TYPE; the
// CrashpadInfo stream id and struct layouts come from Crashpad's headers.

// First 4 bytes of every minidump: ASCII "MDMP" (little-endian).
const MINIDUMP_SIGNATURE = 0x504d444d;

// Stream type ids we read from the stream directory.
const STREAM_MODULE_LIST = 4; // ModuleListStream
const STREAM_EXCEPTION = 6; // ExceptionStream
const STREAM_CRASHPAD_INFO = 0x43500001; // Crashpad's vendor extension

// Each struct below is a flat C record, so a field's offset is the sum of the
// sizes of the fields before it (u32 = 4 bytes, u64 = 8). The layout is written
// out so every offset is derivable from it.

// MINIDUMP_HEADER:
//   u32 signature @0 | u32 version @4 | u32 streamCount @8 | u32 dirRva @12 | ...
// The full header is 32 bytes; the stream directory follows it.
const HEADER_STREAM_COUNT_OFF = 8;
const HEADER_DIR_RVA_OFF = 12;
const HEADER_SIZE = 32;

// Crashpad dumps are normally only a few megabytes. Refuse pathological files
// before following any of their RVAs, and cap the amount of data the random-
// access parser may materialize even for an otherwise valid dump.
export const MAX_MINIDUMP_FILE_BYTES = 128 * 1024 * 1024;
const MAX_MINIDUMP_BYTES_READ = 2 * 1024 * 1024;
const MAX_STREAM_COUNT = 1024;
const MAX_MODULE_COUNT = 4096;
const MAX_CRASHPAD_MODULE_COUNT = 1024;
const MAX_ANNOTATION_COUNT = 1024;
const MAX_STRING_BYTES = 16 * 1024;

// MINIDUMP_DIRECTORY entry (one per stream): a u32 stream type, then a
// LOCATION_DESCRIPTOR { u32 dataSize @4, u32 rva @8 }. 12 bytes total.
const DIR_ENTRY_SIZE = 12;
const DIR_ENTRY_TYPE_OFF = 0;
const DIR_ENTRY_SIZE_OFF = 4;
const DIR_ENTRY_RVA_OFF = 8;

// MINIDUMP_EXCEPTION_STREAM, from the stream's start:
//   u32 threadId          @0
//   u32 alignment         @4
//   -- MINIDUMP_EXCEPTION --
//   u32 exceptionCode     @8
//   u32 exceptionFlags    @12
//   u64 exceptionRecord   @16
//   u64 exceptionAddress  @24
//   u32 numberParameters  @32
//   u32 alignment         @36
//   u64 info[15]          @40  (15 * 8 = 120 bytes, ends @160)
//   -- thread context LOCATION_DESCRIPTOR --
//   u32 dataSize          @160
//   u32 rva               @164  -> file offset of the crashing thread's CPU context
const EXC_CODE_OFF = 8;
const EXC_CONTEXT_RVA_OFF = 164;

// MINIDUMP_MODULE record: u64 base @0, u32 size @8, ... u32 nameRva @20, with
// the whole record being 108 bytes (so module N starts at N * 108).
const MODULE_RECORD_SIZE = 108;
const MODULE_BASE_OFF = 0;
const MODULE_SIZE_OFF = 8;
const MODULE_NAME_RVA_OFF = 20;

// MinidumpCrashpadInfo: u32 version @0 | UUID report_id (16) @4 | UUID client_id
// (16) @20 | LOCATION_DESCRIPTOR simple_annotations (8) @36 | LOCATION_DESCRIPTOR
// module_list (8) @44 | u32 reserved @52 | u64 address_mask @56.
const CRASHPAD_MODULE_LIST_RVA_OFF = 48; // rva field of module_list (@44 + 4)
const CRASHPAD_ADDRESS_MASK_OFF = 56;
const CRASHPAD_INFO_MIN_SIZE_FOR_MASK = 64; // through the end of address_mask
const CRASHPAD_INFO_VERSION_WITH_ADDRESS_MASK = 1;

// On Linux, Crashpad stores the POSIX signal number in ExceptionCode.
const SIGNAL_NAMES: Record<number, string> = {
  4: "SIGILL",
  5: "SIGTRAP",
  6: "SIGABRT",
  7: "SIGBUS",
  8: "SIGFPE",
  11: "SIGSEGV",
  15: "SIGTERM",
};

// On macOS, ExceptionCode is the Mach exception type, not a signal.
const MACH_EXCEPTION_NAMES: Record<number, string> = {
  1: "EXC_BAD_ACCESS",
  2: "EXC_BAD_INSTRUCTION",
  3: "EXC_ARITHMETIC",
  4: "EXC_EMULATION",
  5: "EXC_SOFTWARE",
  6: "EXC_BREAKPOINT",
  7: "EXC_SYSCALL",
  8: "EXC_MACH_SYSCALL",
  9: "EXC_RPC_ALERT",
  10: "EXC_CRASH",
  11: "EXC_RESOURCE",
  12: "EXC_GUARD",
  13: "EXC_CORPSE_NOTIFY",
};

// Windows uses NTSTATUS exception codes; degrades to the raw code when unmatched.
const NTSTATUS_NAMES: Record<number, string> = {
  0xc0000005: "ACCESS_VIOLATION",
  0xc000001d: "ILLEGAL_INSTRUCTION",
  0xc0000094: "INTEGER_DIVIDE_BY_ZERO",
  0xc00000fd: "STACK_OVERFLOW",
  0xc0000409: "STACK_BUFFER_OVERRUN",
  0x80000003: "BREAKPOINT",
};

interface MinidumpSource {
  readonly length: number;
  read(offset: number, length: number): Buffer | null;
}

class BufferMinidumpSource implements MinidumpSource {
  readonly length: number;

  constructor(private readonly buffer: Buffer) {
    this.length = buffer.length;
  }

  read(offset: number, length: number): Buffer | null {
    if (!isValidRange(this.length, offset, length)) return null;
    return this.buffer.subarray(offset, offset + length);
  }
}

class FileMinidumpSource implements MinidumpSource {
  private bytesRead = 0;

  constructor(
    private readonly fd: number,
    readonly length: number,
  ) {}

  read(offset: number, length: number): Buffer | null {
    if (
      !isValidRange(this.length, offset, length) ||
      this.bytesRead + length > MAX_MINIDUMP_BYTES_READ
    ) {
      return null;
    }

    const buffer = Buffer.allocUnsafe(length);
    let position = 0;
    while (position < length) {
      const bytesRead = fs.readSync(
        this.fd,
        buffer,
        position,
        length - position,
        offset + position,
      );
      this.bytesRead += bytesRead;
      if (bytesRead === 0) return null;
      position += bytesRead;
    }
    return buffer;
  }
}

// Byte offset of the instruction pointer (where the crash happened) within each
// architecture's CPU context struct — the struct the exception stream points
// at. Each struct is a flat C record, so the IP's offset is the sum of the sizes
// of the fields ahead of it (u16 = 2 bytes, u32 = 4, u64 = 8). Derived below
// from Breakpad's context structs; values match real dumps.
//
// x64 — rip in MDRawContextAMD64 (minidump_cpu_amd64.h):
//     6 * u64 home params                 =  48
//   + u32 context_flags + u32 mx_csr      =   8  ->  56
//   + 6 * u16 segment regs + u32 eflags   =  16  ->  72
//   + 6 * u64 debug regs (dr0..dr7)       =  48  -> 120
//   + 16 * u64 integer regs (rax..r15)    = 128  -> 248
//   rip is the next field                            => 248
//
// arm64 — pc in MDRawContextARM64 (minidump_cpu_arm64.h):
//     u32 context_flags + u32 cpsr        =   8
//   + 32 * u64 iregs (x0..x30, sp)        = 256  -> 264
//   pc is iregs[32], the next register              => 264
//
// https://chromium.googlesource.com/breakpad/breakpad/+/main/src/google_breakpad/common/minidump_cpu_amd64.h
// https://chromium.googlesource.com/breakpad/breakpad/+/main/src/google_breakpad/common/minidump_cpu_arm64.h
const IP_OFFSET_IN_CONTEXT: Partial<Record<NodeJS.Architecture, number>> = {
  x64: 248,
  arm64: 264,
};

// Read a minidump file from disk and summarize it. Returns null if the file
// can't be read or isn't a valid minidump.
export function parseMinidumpSummary(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): MinidumpSummary | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const stat = fs.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.size < HEADER_SIZE ||
      stat.size > MAX_MINIDUMP_FILE_BYTES
    ) {
      return null;
    }
    return parseMinidumpSource(
      new FileMinidumpSource(fd, stat.size),
      platform,
      arch,
    );
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Best effort. Parsing has already completed or failed.
      }
    }
  }
}

// Parse an in-memory minidump into a MinidumpSummary. Finds the streams it needs
// via the directory, decodes the crash reason from the exception code, resolves
// the faulting instruction pointer to a module + offset, and reads the process
// type. Returns null if the buffer is not a valid minidump; individual fields
// are left undefined when their stream is missing or malformed.
export function parseMinidumpBuffer(
  buf: Buffer,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): MinidumpSummary | null {
  return parseMinidumpSource(new BufferMinidumpSource(buf), platform, arch);
}

function parseMinidumpSource(
  source: MinidumpSource,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): MinidumpSummary | null {
  try {
    const header = source.read(0, HEADER_SIZE);
    if (!header || header.readUInt32LE(0) !== MINIDUMP_SIGNATURE) {
      return null;
    }
    const numStreams = header.readUInt32LE(HEADER_STREAM_COUNT_OFF);
    const dirRva = header.readUInt32LE(HEADER_DIR_RVA_OFF);
    if (numStreams > MAX_STREAM_COUNT) return null;
    const directory = source.read(dirRva, numStreams * DIR_ENTRY_SIZE);
    if (!directory) return null;

    // Walk the stream directory, recording the file offset (rva) of each stream
    // we care about.
    let moduleListRva = 0;
    let exceptionRva = 0;
    let exceptionSize = 0;
    let crashpadInfoRva = 0;
    let crashpadInfoSize = 0;
    for (let i = 0; i < numStreams; i++) {
      const entry = i * DIR_ENTRY_SIZE;
      const type = directory.readUInt32LE(entry + DIR_ENTRY_TYPE_OFF);
      const size = directory.readUInt32LE(entry + DIR_ENTRY_SIZE_OFF);
      const rva = directory.readUInt32LE(entry + DIR_ENTRY_RVA_OFF);
      if (type === STREAM_MODULE_LIST) moduleListRva = rva;
      else if (type === STREAM_EXCEPTION) {
        exceptionRva = rva;
        exceptionSize = size;
      } else if (type === STREAM_CRASHPAD_INFO) {
        crashpadInfoRva = rva;
        crashpadInfoSize = size;
      }
    }

    if (exceptionRva === 0 || exceptionSize < EXC_CONTEXT_RVA_OFF + 4) {
      return null;
    }
    const exception = source.read(exceptionRva, EXC_CONTEXT_RVA_OFF + 4);
    if (!exception) return null;
    const exceptionCode = exception.readUInt32LE(EXC_CODE_OFF);

    const crashReason =
      platform === "win32"
        ? NTSTATUS_NAMES[exceptionCode >>> 0]
        : platform === "darwin"
          ? MACH_EXCEPTION_NAMES[exceptionCode]
          : SIGNAL_NAMES[exceptionCode];

    // The faulting CODE location is the instruction pointer from the crashing
    // thread's CPU context — not ExceptionAddress, which on a null-deref/abort
    // is the (zero) data fault address. The exception stream points to that
    // context; the IP sits at an arch-specific offset within it.
    let instructionPointer = 0n;
    const ipOffset = IP_OFFSET_IN_CONTEXT[arch];
    if (ipOffset !== undefined) {
      const contextRva = exception.readUInt32LE(EXC_CONTEXT_RVA_OFF);
      instructionPointer = readBigUInt64(source, contextRva + ipOffset) ?? 0n;
    }

    // On arm64 the saved pointer can carry pointer-auth / top-byte tag bits.
    // Crashpad records an address_mask to recover the real address before module
    // lookup.
    if (instructionPointer !== 0n && crashpadInfoRva) {
      const mask = readAddressMask(source, crashpadInfoRva, crashpadInfoSize);
      instructionPointer = applyAddressMask(instructionPointer, mask);
    }

    let faultingModule: string | undefined;
    let faultingOffset: string | undefined;
    if (moduleListRva !== 0 && instructionPointer !== 0n) {
      const module = findModule(source, moduleListRva, instructionPointer);
      if (module) {
        faultingModule = basename(module.name);
        faultingOffset = "0x" + (instructionPointer - module.base).toString(16);
      }
    }

    return {
      crashReason,
      exceptionCode,
      faultingModule,
      faultingOffset,
      ptype: crashpadInfoRva ? parsePtype(source, crashpadInfoRva) : undefined,
    };
  } catch {
    return null;
  }
}

// Read the "ptype" Crashpad annotation (the crashing process type) from the
// MinidumpCrashpadInfo stream. Nested structs we walk, with the byte offset of
// the field we read from each:
//
//   MinidumpCrashpadInfo        ->  module_list rva          @ +48
//   module_list                 ->  count, then 12-byte links
//     link                      ->  module_info rva          @ +8
//   MinidumpModuleCrashpadInfo  ->  annotation_objects rva   @ +24
//   annotation_objects          ->  count, then 12-byte annotations
//     annotation                ->  name rva @ +0, value rva @ +8
//
// name and value are length-prefixed UTF-8; return the value named "ptype".
function parsePtype(
  source: MinidumpSource,
  infoRva: number,
): string | undefined {
  try {
    const modListRva = readUInt32(
      source,
      infoRva + CRASHPAD_MODULE_LIST_RVA_OFF,
    );
    if (!modListRva) return undefined;
    const moduleCount = readUInt32(source, modListRva);
    if (moduleCount === undefined || moduleCount > MAX_CRASHPAD_MODULE_COUNT) {
      return undefined;
    }
    const links = source.read(modListRva + 4, moduleCount * 12);
    if (!links) return undefined;

    for (let i = 0; i < moduleCount; i++) {
      const moduleInfoRva = links.readUInt32LE(i * 12 + 8);
      const objectsRva = readUInt32(source, moduleInfoRva + 24);
      if (!objectsRva) continue;
      const objectCount = readUInt32(source, objectsRva);
      if (objectCount === undefined || objectCount > MAX_ANNOTATION_COUNT) {
        continue;
      }
      const objects = source.read(objectsRva + 4, objectCount * 12);
      if (!objects) continue;

      for (let j = 0; j < objectCount; j++) {
        const obj = j * 12;
        if (readLengthPrefixed(source, objects.readUInt32LE(obj)) === "ptype") {
          return readLengthPrefixed(source, objects.readUInt32LE(obj + 8));
        }
      }
    }
  } catch {
    // best effort — ptype is optional context
  }
  return undefined;
}

// Read the address_mask from the MinidumpCrashpadInfo stream, used to strip
// pointer-tag bits from addresses (arm64). Returns 0n when absent — older dumps
// don't have the field, so only read it when the stream is long enough.
function readAddressMask(
  source: MinidumpSource,
  infoRva: number,
  infoSize: number,
): bigint {
  if (infoSize < CRASHPAD_INFO_MIN_SIZE_FOR_MASK) {
    return 0n;
  }
  const version = readUInt32(source, infoRva);
  if (
    version === undefined ||
    version < CRASHPAD_INFO_VERSION_WITH_ADDRESS_MASK
  ) {
    return 0n;
  }
  return readBigUInt64(source, infoRva + CRASHPAD_ADDRESS_MASK_OFF) ?? 0n;
}

// Recover a real address from a tagged arm64 pointer using Crashpad's mask. Per
// Crashpad: clear the masked (tag) bits, or set them when bit 55 is set (the
// pointer is in high memory). A 0 mask means no tagging — return as-is.
function applyAddressMask(pointer: bigint, mask: bigint): bigint {
  if (mask === 0n) return pointer;
  const HIGH_MEMORY_BIT = 1n << 55n;
  return (pointer & HIGH_MEMORY_BIT) !== 0n ? pointer | mask : pointer & ~mask;
}

// A u32 byte-length followed by UTF-8 bytes (MinidumpUTF8String / ByteArray).
function readLengthPrefixed(source: MinidumpSource, rva: number): string {
  if (rva === 0) return "";
  const length = readUInt32(source, rva);
  if (!length || length > MAX_STRING_BYTES) return "";
  return source.read(rva + 4, length)?.toString("utf8") ?? "";
}

// Parse the module list stream into the base address, size, and name of each
// loaded module. (MINIDUMP_MODULE_LIST: a u32 count, then `count` fixed-size
// module records.)
function findModule(
  source: MinidumpSource,
  rva: number,
  address: bigint,
): { base: bigint; size: number; name: string } | undefined {
  const count = readUInt32(source, rva);
  if (count === undefined || count > MAX_MODULE_COUNT) return undefined;
  const records = source.read(rva + 4, count * MODULE_RECORD_SIZE);
  if (!records) return undefined;

  for (let i = 0; i < count; i++) {
    const m = i * MODULE_RECORD_SIZE;
    const base = records.readBigUInt64LE(m + MODULE_BASE_OFF);
    const size = records.readUInt32LE(m + MODULE_SIZE_OFF);
    if (address >= base && address < base + BigInt(size)) {
      const nameRva = records.readUInt32LE(m + MODULE_NAME_RVA_OFF);
      return { base, size, name: readMinidumpString(source, nameRva) };
    }
  }
  return undefined;
}

// MINIDUMP_STRING: u32 byte-length followed by UTF-16LE.
function readMinidumpString(source: MinidumpSource, rva: number): string {
  if (rva === 0) return "";
  const byteLength = readUInt32(source, rva);
  if (!byteLength || byteLength > MAX_STRING_BYTES) return "";
  return source.read(rva + 4, byteLength)?.toString("utf16le") ?? "";
}

function readUInt32(
  source: MinidumpSource,
  offset: number,
): number | undefined {
  return source.read(offset, 4)?.readUInt32LE(0);
}

function readBigUInt64(
  source: MinidumpSource,
  offset: number,
): bigint | undefined {
  return source.read(offset, 8)?.readBigUInt64LE(0);
}

function isValidRange(
  sourceLength: number,
  offset: number,
  length: number,
): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset <= sourceLength - length
  );
}

// Last path segment of a module path, handling both / and \ separators (module
// names are full paths, and Windows dumps use backslashes).
function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}
