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

// Crashpad stores the POSIX signal number in ExceptionCode on Linux/macOS.
const SIGNAL_NAMES: Record<number, string> = {
  4: "SIGILL",
  5: "SIGTRAP",
  6: "SIGABRT",
  7: "SIGBUS",
  8: "SIGFPE",
  11: "SIGSEGV",
  15: "SIGTERM",
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

interface MinidumpModule {
  base: bigint;
  size: number;
  name: string;
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
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  return parseMinidumpBuffer(buf, platform, arch);
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
  try {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (
      buf.length < HEADER_SIZE ||
      view.getUint32(0, true) !== MINIDUMP_SIGNATURE
    ) {
      return null;
    }
    const numStreams = view.getUint32(HEADER_STREAM_COUNT_OFF, true);
    const dirRva = view.getUint32(HEADER_DIR_RVA_OFF, true);

    // Walk the stream directory, recording the file offset (rva) of each stream
    // we care about.
    let moduleListRva = 0;
    let exceptionRva = 0;
    let crashpadInfoRva = 0;
    let crashpadInfoSize = 0;
    for (let i = 0; i < numStreams; i++) {
      const entry = dirRva + i * DIR_ENTRY_SIZE;
      if (entry + DIR_ENTRY_SIZE > buf.length) break;
      const type = view.getUint32(entry + DIR_ENTRY_TYPE_OFF, true);
      const size = view.getUint32(entry + DIR_ENTRY_SIZE_OFF, true);
      const rva = view.getUint32(entry + DIR_ENTRY_RVA_OFF, true);
      if (type === STREAM_MODULE_LIST) moduleListRva = rva;
      else if (type === STREAM_EXCEPTION) exceptionRva = rva;
      else if (type === STREAM_CRASHPAD_INFO) {
        crashpadInfoRva = rva;
        crashpadInfoSize = size;
      }
    }

    if (exceptionRva === 0 || exceptionRva + EXC_CONTEXT_RVA_OFF > buf.length) {
      return null;
    }
    const exceptionCode = view.getUint32(exceptionRva + EXC_CODE_OFF, true);

    const crashReason =
      platform === "win32"
        ? NTSTATUS_NAMES[exceptionCode >>> 0]
        : SIGNAL_NAMES[exceptionCode];

    // The faulting CODE location is the instruction pointer from the crashing
    // thread's CPU context — not ExceptionAddress, which on a null-deref/abort
    // is the (zero) data fault address. The exception stream points to that
    // context; the IP sits at an arch-specific offset within it.
    let instructionPointer = 0n;
    const ipOffset = IP_OFFSET_IN_CONTEXT[arch];
    if (
      ipOffset !== undefined &&
      exceptionRva + EXC_CONTEXT_RVA_OFF + 4 <= buf.length
    ) {
      const contextRva = view.getUint32(
        exceptionRva + EXC_CONTEXT_RVA_OFF,
        true,
      );
      if (contextRva + ipOffset + 8 <= buf.length) {
        instructionPointer = view.getBigUint64(contextRva + ipOffset, true);
      }
    }

    // On arm64 the saved pointer can carry pointer-auth / top-byte tag bits.
    // Crashpad records an address_mask to recover the real address before module
    // lookup.
    if (instructionPointer !== 0n && crashpadInfoRva) {
      const mask = readAddressMask(
        view,
        buf,
        crashpadInfoRva,
        crashpadInfoSize,
      );
      instructionPointer = applyAddressMask(instructionPointer, mask);
    }

    let faultingModule: string | undefined;
    let faultingOffset: string | undefined;
    if (moduleListRva !== 0 && instructionPointer !== 0n) {
      const module = findModule(
        parseModules(view, buf, moduleListRva),
        instructionPointer,
      );
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
      ptype: crashpadInfoRva
        ? parsePtype(view, buf, crashpadInfoRva)
        : undefined,
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
  view: DataView,
  buf: Buffer,
  infoRva: number,
): string | undefined {
  try {
    if (infoRva + CRASHPAD_MODULE_LIST_RVA_OFF + 4 > buf.length) {
      return undefined;
    }
    const modListRva = view.getUint32(
      infoRva + CRASHPAD_MODULE_LIST_RVA_OFF,
      true,
    );
    if (modListRva === 0 || modListRva + 4 > buf.length) return undefined;
    const moduleCount = view.getUint32(modListRva, true);
    for (let i = 0; i < moduleCount; i++) {
      const link = modListRva + 4 + i * 12;
      if (link + 12 > buf.length) break;
      const moduleInfoRva = view.getUint32(link + 8, true);
      if (moduleInfoRva + 28 > buf.length) continue;
      const objectsRva = view.getUint32(moduleInfoRva + 24, true);
      if (objectsRva === 0 || objectsRva + 4 > buf.length) continue;
      const objectCount = view.getUint32(objectsRva, true);
      for (let j = 0; j < objectCount; j++) {
        const obj = objectsRva + 4 + j * 12;
        if (obj + 12 > buf.length) break;
        if (
          readLengthPrefixed(view, buf, view.getUint32(obj, true)) === "ptype"
        ) {
          return readLengthPrefixed(view, buf, view.getUint32(obj + 8, true));
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
  view: DataView,
  buf: Buffer,
  infoRva: number,
  infoSize: number,
): bigint {
  if (
    infoSize < CRASHPAD_INFO_MIN_SIZE_FOR_MASK ||
    infoRva + CRASHPAD_ADDRESS_MASK_OFF + 8 > buf.length
  ) {
    return 0n;
  }
  return view.getBigUint64(infoRva + CRASHPAD_ADDRESS_MASK_OFF, true);
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
function readLengthPrefixed(view: DataView, buf: Buffer, rva: number): string {
  if (rva === 0 || rva + 4 > buf.length) return "";
  const len = view.getUint32(rva, true);
  const start = rva + 4;
  if (len <= 0 || start + len > buf.length) return "";
  return buf.toString("utf8", start, start + len);
}

// Parse the module list stream into the base address, size, and name of each
// loaded module. (MINIDUMP_MODULE_LIST: a u32 count, then `count` fixed-size
// module records.)
function parseModules(
  view: DataView,
  buf: Buffer,
  rva: number,
): MinidumpModule[] {
  if (rva + 4 > buf.length) return [];
  const count = view.getUint32(rva, true);
  const modules: MinidumpModule[] = [];
  for (let i = 0; i < count; i++) {
    const m = rva + 4 + i * MODULE_RECORD_SIZE;
    if (m + MODULE_RECORD_SIZE > buf.length) break;
    const base = view.getBigUint64(m + MODULE_BASE_OFF, true);
    const size = view.getUint32(m + MODULE_SIZE_OFF, true);
    const nameRva = view.getUint32(m + MODULE_NAME_RVA_OFF, true);
    modules.push({ base, size, name: readMinidumpString(view, buf, nameRva) });
  }
  return modules;
}

// Find the loaded module whose address range contains the given address (the
// crash IP), or undefined if it falls outside every module.
function findModule(
  modules: MinidumpModule[],
  address: bigint,
): MinidumpModule | undefined {
  return modules.find(
    (m) => address >= m.base && address < m.base + BigInt(m.size),
  );
}

// MINIDUMP_STRING: u32 byte-length followed by UTF-16LE.
function readMinidumpString(view: DataView, buf: Buffer, rva: number): string {
  if (rva === 0 || rva + 4 > buf.length) return "";
  const byteLength = view.getUint32(rva, true);
  const start = rva + 4;
  if (byteLength <= 0 || start + byteLength > buf.length) return "";
  return buf.toString("utf16le", start, start + byteLength);
}

// Last path segment of a module path, handling both / and \ separators (module
// names are full paths, and Windows dumps use backslashes).
function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}
