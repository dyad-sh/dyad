import fs from "node:fs";

// A small, symbol-free summary extracted from a minidump: enough to attribute a
// native crash (which signal, which module faulted) without any memory contents,
// so it is safe to send as telemetry. Not a full stack walk — just the faulting
// frame's module + offset, which can be resolved to a function name offline
// against public symbols using the recorded app/Electron version.
export interface MinidumpSummary {
  crashReason?: string; // e.g. "SIGABRT" / "SIGSEGV" (POSIX) or NTSTATUS name
  exceptionCode: number; // raw code, in case the name table misses it
  faultAddress?: `0x${string}` | "non-null"; // for memory faults; exact only near null
  accessType?: "read" | "write" | "execute"; // Windows access violations and in-page errors
  inPageErrorStatus?: string; // NTSTATUS of the paging failure, hex (e.g. "0xc000009c")
  oomAllocationSizeBytes?: number; // failed allocation size for Chromium OOM crashes
  fastFailCode?: number; // FAST_FAIL reason for Windows 0xC0000409, e.g. 7 is abort()
  faultingModule?: string; // basename of the module containing the crash address
  faultingOffset?: string; // hex offset of the crash address within that module
  faultingDebugFile?: string; // name keying the module's symbol file, e.g. "electron.exe.pdb"
  faultingDebugId?: string; // build fingerprint keying the module's symbol file
  ptype?: string; // crashing process type: "browser" (main) / "renderer" / "gpu-process" / …
  // All Crashpad annotations: our crashReporter extra parameters and
  // Chromium's own crash keys. Counts and lengths are capped.
  annotations?: Record<string, string>;
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
const EXC_FLAGS_OFF = 12;
const EXC_ADDRESS_OFF = 24;
const EXC_NUM_PARAMS_OFF = 32;
const EXC_PARAMS_OFF = 40;
const EXC_MAX_PARAMS = 15;
const EXC_CONTEXT_RVA_OFF = 164;
// The stream is a fixed-size struct. A smaller declared size means the dump
// is corrupt, and reads past it would land in a neighboring stream's bytes.
const EXC_STREAM_SIZE = 168;

// Exception codes whose parameters carry extra detail on Windows.
const EXC_CODE_ACCESS_VIOLATION = 0xc0000005;
const EXC_CODE_IN_PAGE_ERROR = 0xc0000006;
const EXC_CODE_CHROMIUM_OOM = 0xe0000008; // Chromium's kOomExceptionCode
const EXC_CODE_FAST_FAIL = 0xc0000409;

// ACCESS_VIOLATION parameter 0: how the faulting address was accessed.
const ACCESS_TYPES: Record<number, "read" | "write" | "execute"> = {
  0: "read",
  1: "write",
  8: "execute",
};

// macOS EXC_BAD_ACCESS code values whose subcode carries no data fault
// address; Crashpad stores the instruction pointer instead.
const MACH_BAD_ACCESS_GPFLT = 13n; // EXC_I386_GPFLT
const MACH_BAD_ACCESS_PROT_COLLISION = 5n; // VM_PROT_READ | VM_PROT_EXECUTE
const LINUX_SI_KERNEL = 0x80; // si_code of kernel-origin faults without si_addr

// MINIDUMP_MODULE record: u64 base @0, u32 size @8, ... u32 nameRva @20, with
// the whole record being 108 bytes (so module N starts at N * 108).
// VS_FIXEDFILEINFO (52 bytes) sits at @24, so the CvRecord
// LOCATION_DESCRIPTOR follows at @76 (dataSize) and @80 (rva).
const MODULE_RECORD_SIZE = 108;
const MODULE_BASE_OFF = 0;
const MODULE_SIZE_OFF = 8;
const MODULE_NAME_RVA_OFF = 20;
const MODULE_CV_SIZE_OFF = 76;
const MODULE_CV_RVA_OFF = 80;

// CodeView record signatures.
const CV_SIG_PDB70 = 0x53445352; // "RSDS": GUID + age + debug file name
const CV_SIG_ELF_BUILD_ID = 0x4270454c; // Crashpad's ELF build id record

// MinidumpCrashpadInfo: u32 version @0 | UUID report_id (16) @4 | UUID client_id
// (16) @20 | LOCATION_DESCRIPTOR simple_annotations (8) @36 | LOCATION_DESCRIPTOR
// module_list (8) @44 | u32 reserved @52 | u64 address_mask @56.
const CRASHPAD_MODULE_LIST_RVA_OFF = 48; // rva field of module_list (@44 + 4)
const CRASHPAD_SIMPLE_ANNOTATIONS_RVA_OFF = 40; // rva field of simple_annotations (@36 + 4)

// MinidumpModuleCrashpadInfo: u32 version @0 | LOCATION_DESCRIPTOR
// list_annotations (8) @4 | LOCATION_DESCRIPTOR simple_annotations (8) @12
// | LOCATION_DESCRIPTOR annotation_objects (8) @20.
const MODULE_INFO_SIMPLE_RVA_OFF = 16; // rva field of simple_annotations (@12 + 4)
const MODULE_INFO_OBJECTS_RVA_OFF = 24; // rva field of annotation_objects (@20 + 4)
const CRASHPAD_ADDRESS_MASK_OFF = 56;
const CRASHPAD_INFO_MIN_SIZE_FOR_MASK = 64; // through the end of address_mask

// Crashpad annotation object type for plain string values.
const ANNOTATION_TYPE_STRING = 1;

// Caps so a corrupt dump cannot balloon the summary.
const MAX_ANNOTATIONS = 32;
const MAX_ANNOTATION_KEY_LEN = 64;
const MAX_ANNOTATION_VALUE_LEN = 512;
// Bound on counts read from the dump, so a corrupt count cannot spin the
// scan loops. Generous next to real dumps, which hold about 20 entries.
const MAX_ANNOTATION_SCAN = 64;

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
  0xc0000006: "IN_PAGE_ERROR",
  0xc000001d: "ILLEGAL_INSTRUCTION",
  0xc0000094: "INTEGER_DIVIDE_BY_ZERO",
  0xc00000fd: "STACK_OVERFLOW",
  0xc0000409: "STACK_BUFFER_OVERRUN",
  0x80000003: "BREAKPOINT",
  // Not a real NTSTATUS value. This is Chromium's kOomExceptionCode.
  0xe0000008: "OUT_OF_MEMORY",
};

interface MinidumpModule {
  base: bigint;
  size: number;
  name: string;
  recordRva: number; // file offset of this module's 108-byte record
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
    let exceptionSize = 0;
    let crashpadInfoRva = 0;
    let crashpadInfoSize = 0;
    for (let i = 0; i < numStreams; i++) {
      const entry = dirRva + i * DIR_ENTRY_SIZE;
      if (entry + DIR_ENTRY_SIZE > buf.length) break;
      const type = view.getUint32(entry + DIR_ENTRY_TYPE_OFF, true);
      const size = view.getUint32(entry + DIR_ENTRY_SIZE_OFF, true);
      const rva = view.getUint32(entry + DIR_ENTRY_RVA_OFF, true);
      if (type === STREAM_MODULE_LIST) moduleListRva = rva;
      else if (type === STREAM_EXCEPTION) {
        exceptionRva = rva;
        exceptionSize = size;
      } else if (type === STREAM_CRASHPAD_INFO) {
        crashpadInfoRva = rva;
        crashpadInfoSize = size;
      }
    }

    if (
      exceptionRva === 0 ||
      exceptionSize < EXC_STREAM_SIZE ||
      exceptionRva + EXC_STREAM_SIZE > buf.length
    ) {
      return null;
    }
    const exceptionCode = view.getUint32(exceptionRva + EXC_CODE_OFF, true);

    // On arm64, saved addresses can carry pointer-auth / top-byte tag bits.
    // Crashpad records an address_mask to recover the real address.
    const addressMask = crashpadInfoRva
      ? readAddressMask(view, buf, crashpadInfoRva, crashpadInfoSize)
      : 0n;

    const details = parseExceptionDetails(
      view,
      exceptionRva,
      exceptionCode,
      platform,
      addressMask,
    );

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
      const contextRva = view.getUint32(
        exceptionRva + EXC_CONTEXT_RVA_OFF,
        true,
      );
      if (contextRva + ipOffset + 8 <= buf.length) {
        instructionPointer = view.getBigUint64(contextRva + ipOffset, true);
      }
    }

    if (instructionPointer !== 0n) {
      instructionPointer = applyAddressMask(instructionPointer, addressMask);
    }

    let faultingModule: string | undefined;
    let faultingOffset: string | undefined;
    let faultingDebugFile: string | undefined;
    let faultingDebugId: string | undefined;
    if (moduleListRva !== 0 && instructionPointer !== 0n) {
      const module = findModule(
        parseModules(view, buf, moduleListRva),
        instructionPointer,
      );
      if (module) {
        faultingModule = basename(module.name);
        faultingOffset = "0x" + (instructionPointer - module.base).toString(16);
        const identity = parseDebugIdentity(view, buf, module.recordRva);
        faultingDebugId = identity.debugId;
        // ELF build id records carry no name; the module name keys the file.
        faultingDebugFile = identity.debugId
          ? (identity.debugFile ?? faultingModule)
          : undefined;
      }
    }

    const annotations = crashpadInfoRva
      ? parseAnnotations(view, buf, crashpadInfoRva)
      : undefined;

    return {
      crashReason,
      exceptionCode,
      ...details,
      faultingModule,
      faultingOffset,
      faultingDebugFile,
      faultingDebugId,
      ptype: annotations?.ptype,
      annotations,
    };
  } catch {
    return null;
  }
}

// Read the extra detail the exception record carries: the parameter array
// (ExceptionInformation) and the data fault address. Parameter meaning depends
// on the exception code; only codes where they say something useful are
// mapped. All reads stay within the bounds already checked by the caller
// (the exception stream spans at least EXC_STREAM_SIZE bytes).
function parseExceptionDetails(
  view: DataView,
  exceptionRva: number,
  exceptionCode: number,
  platform: NodeJS.Platform,
  addressMask: bigint,
): Pick<
  MinidumpSummary,
  | "faultAddress"
  | "accessType"
  | "inPageErrorStatus"
  | "oomAllocationSizeBytes"
  | "fastFailCode"
> {
  const numParams = Math.min(
    view.getUint32(exceptionRva + EXC_NUM_PARAMS_OFF, true),
    EXC_MAX_PARAMS,
  );
  const params: bigint[] = [];
  for (let i = 0; i < numParams; i++) {
    params.push(view.getBigUint64(exceptionRva + EXC_PARAMS_OFF + i * 8, true));
  }

  if (platform === "win32") {
    if (exceptionCode === EXC_CODE_ACCESS_VIOLATION && params.length >= 2) {
      return {
        accessType: ACCESS_TYPES[Number(params[0])],
        faultAddress: redactFaultAddress(params[1], addressMask),
      };
    }
    if (exceptionCode === EXC_CODE_IN_PAGE_ERROR && params.length >= 2) {
      // Same first two parameters as an access violation, plus the NTSTATUS
      // of the paging failure (e.g. a failing disk or dropped network share).
      return {
        accessType: ACCESS_TYPES[Number(params[0])],
        faultAddress: redactFaultAddress(params[1], addressMask),
        // The 32-bit NTSTATUS is sign extended into the 64-bit slot;
        // mask it so every dump prints the status the same way.
        ...(params.length >= 3 && {
          inPageErrorStatus: toHex(params[2] & 0xffffffffn),
        }),
      };
    }
    if (exceptionCode === EXC_CODE_CHROMIUM_OOM && params.length >= 1) {
      // Number is exact below 2^53 bytes (9 PB), far beyond any real allocation.
      return { oomAllocationSizeBytes: Number(params[0]) };
    }
    if (exceptionCode === EXC_CODE_FAST_FAIL && params.length >= 1) {
      return { fastFailCode: Number(params[0]) };
    }
    return {};
  }

  // On POSIX, Crashpad stores the data fault address in ExceptionAddress.
  // Only memory faults have one; for other signals the field is meaningless.
  // On macOS the parameters are [exception, code0, code1]. For general
  // protection faults and the read|execute protection collision, there is
  // no data fault address and Crashpad stores the instruction pointer
  // instead, so skip the field for those code0 values.
  const machCode0 = params.length >= 2 ? params[1] : undefined;
  // On Linux the exception flags field holds si_code. Kernel-origin
  // faults (SI_KERNEL, e.g. a general protection fault from a
  // non-canonical address) have no valid fault address and store 0,
  // which would read as a null dereference.
  const siCode = view.getUint32(exceptionRva + EXC_FLAGS_OFF, true);
  const isMemoryFault =
    platform === "darwin"
      ? exceptionCode === 1 && // EXC_BAD_ACCESS
        machCode0 !== MACH_BAD_ACCESS_GPFLT &&
        machCode0 !== MACH_BAD_ACCESS_PROT_COLLISION
      : (exceptionCode === 11 || exceptionCode === 7) && // SIGSEGV, SIGBUS
        siCode !== LINUX_SI_KERNEL;
  if (isMemoryFault) {
    return {
      faultAddress: redactFaultAddress(
        view.getBigUint64(exceptionRva + EXC_ADDRESS_OFF, true),
        addressMask,
      ),
    };
  }
  return {};
}

function toHex(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}

// Fault addresses are only diagnostic near null, where they mean a field
// access off a null pointer. An exact address past the null page would
// expose ASLR layout, and after memory corruption the "pointer" can hold
// application bytes, so those values are reduced to "non-null" before
// they can reach telemetry or logs.
const NULL_PAGE_LIMIT = 0xffffn;

function redactFaultAddress(
  address: bigint,
  mask: bigint,
): `0x${string}` | "non-null" {
  const masked = applyAddressMask(address, mask);
  return masked <= NULL_PAGE_LIMIT ? toHex(masked) : "non-null";
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
  // Decode no more than the caps can keep (4 bytes per UTF-8 character at
  // worst), so a corrupt length cannot decode megabytes just to be sliced.
  const capped = Math.min(len, MAX_ANNOTATION_VALUE_LEN * 4);
  return buf.toString("utf8", start, start + capped);
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
    modules.push({
      base,
      size,
      name: readMinidumpString(view, buf, nameRva),
      recordRva: m,
    });
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

// Debug identity from a module's CodeView record: the file name and the
// Breakpad debug id that key the module's symbol file on a symbol server.
function parseDebugIdentity(
  view: DataView,
  buf: Buffer,
  moduleRecordRva: number,
): { debugFile?: string; debugId?: string } {
  try {
    if (moduleRecordRva + MODULE_CV_RVA_OFF + 4 > buf.length) {
      return {};
    }
    const cvSize = view.getUint32(moduleRecordRva + MODULE_CV_SIZE_OFF, true);
    const cvRva = view.getUint32(moduleRecordRva + MODULE_CV_RVA_OFF, true);
    if (cvRva === 0 || cvSize < 4 || cvRva + cvSize > buf.length) {
      return {};
    }
    const signature = view.getUint32(cvRva, true);
    // Minimum pdb70 size: 4 signature + 16 GUID + 4 age + 1 for the name's
    // NUL terminator.
    if (signature === CV_SIG_PDB70 && cvSize >= 25) {
      // "RSDS" | GUID (16) | u32 age | debug file name, NUL terminated.
      const guid = buf.subarray(cvRva + 4, cvRva + 20);
      const age = view.getUint32(cvRva + 20, true);
      const nameStart = cvRva + 24;
      let nameEnd = buf.indexOf(0, nameStart);
      if (nameEnd < 0 || nameEnd > cvRva + cvSize) {
        nameEnd = cvRva + cvSize;
      }
      const debugFile = basename(buf.toString("utf8", nameStart, nameEnd));
      return {
        debugFile: debugFile || undefined,
        debugId: formatDebugId(guid, age),
      };
    }
    if (signature === CV_SIG_ELF_BUILD_ID && cvSize > 4) {
      // "BpEL" | raw build id. The id is the first 16 bytes with age 0,
      // and there is no name field. Buffer.alloc zero fills, so a build
      // id shorter than 16 bytes comes out zero padded; Math.min stops
      // the copy at whichever ends first, the 16 bytes or the record.
      const raw = Buffer.alloc(16);
      buf.copy(raw, 0, cvRva + 4, Math.min(cvRva + 20, cvRva + cvSize));
      return { debugId: formatDebugId(raw, 0) };
    }
  } catch {
    // best effort: the debug identity is optional
  }
  return {};
}

// Breakpad debug id: the GUID's first three fields are stored little
// endian and printed byte swapped, then the rest in order, then the age
// in hex, all uppercase.
function formatDebugId(guid: Buffer, age: number): string {
  const ordered = [
    // A GUID is u32 + u16 + u16 + 8 raw bytes. The integers are stored
    // little endian but print big endian, so reverse the bytes within
    // each one. Data1, 4 bytes:
    guid[3],
    guid[2],
    guid[1],
    guid[0],
    // Data2 and Data3, 2 bytes each:
    guid[5],
    guid[4],
    guid[7],
    guid[6],
    // Data4 is raw bytes with no internal order to fix.
    ...guid.subarray(8, 16),
  ];
  // Two hex digits per byte, zero padded so 0x5 prints as "05".
  const hex = ordered.map((b) => b.toString(16).padStart(2, "0")).join("");
  return (hex + age.toString(16)).toUpperCase();
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

// All Crashpad annotations in the dump: the process-level simple annotations
// dictionary plus each module's string annotation objects. This is where our
// crashReporter extra parameters and Chromium's crash keys live. Returns
// undefined when the dump has none.
function parseAnnotations(
  view: DataView,
  buf: Buffer,
  infoRva: number,
): Record<string, string> | undefined {
  const annotations: Record<string, string> = {};
  try {
    // Module annotations first: they hold ptype, which the summary needs
    // to attribute the crash. First writer wins in addAnnotation, so the
    // process-level dictionary cannot overwrite them.
    readModuleAnnotations(view, buf, infoRva, annotations);
    readSimpleAnnotations(view, buf, infoRva, annotations);
  } catch {
    // best effort: keep whatever was collected
  }
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

// MinidumpSimpleStringDictionary: u32 count, then 8-byte entries of
// { key rva @ +0, value rva @ +4 }, both length-prefixed UTF-8. Used for
// the process-level dictionary and each module's simple annotations.
function readSimpleDictionary(
  view: DataView,
  buf: Buffer,
  dictRva: number,
  out: Record<string, string>,
): void {
  if (dictRva === 0 || dictRva + 4 > buf.length) return;
  const count = Math.min(view.getUint32(dictRva, true), MAX_ANNOTATION_SCAN);
  for (let i = 0; i < count; i++) {
    const entry = dictRva + 4 + i * 8;
    if (entry + 8 > buf.length) break;
    addAnnotation(
      out,
      readLengthPrefixed(view, buf, view.getUint32(entry, true)),
      readLengthPrefixed(view, buf, view.getUint32(entry + 4, true)),
    );
  }
}

function readSimpleAnnotations(
  view: DataView,
  buf: Buffer,
  infoRva: number,
  out: Record<string, string>,
): void {
  if (infoRva + CRASHPAD_SIMPLE_ANNOTATIONS_RVA_OFF + 4 > buf.length) return;
  readSimpleDictionary(
    view,
    buf,
    view.getUint32(infoRva + CRASHPAD_SIMPLE_ANNOTATIONS_RVA_OFF, true),
    out,
  );
}

// Nested structs we walk, with the byte offset of the field we read from each:
//
//   MinidumpCrashpadInfo        ->  module_list rva          @ +48
//   module_list                 ->  count, then 12-byte links
//     link                      ->  module_info rva          @ +8
//   MinidumpModuleCrashpadInfo  ->  simple_annotations rva   @ +16
//                                   annotation_objects rva   @ +24
//   annotation_objects          ->  count, then 12-byte annotations
//     annotation                ->  name rva @ +0, u16 type @ +4, value rva @ +8
//
// Each module carries a simple annotations dictionary and typed annotation
// objects; both are read. Only string-typed objects are collected; other
// types hold binary data. The loops run to their bounded counts instead of
// stopping at the cap, so a late ptype object is still found.
function readModuleAnnotations(
  view: DataView,
  buf: Buffer,
  infoRva: number,
  out: Record<string, string>,
): void {
  if (infoRva + CRASHPAD_MODULE_LIST_RVA_OFF + 4 > buf.length) return;
  const modListRva = view.getUint32(
    infoRva + CRASHPAD_MODULE_LIST_RVA_OFF,
    true,
  );
  if (modListRva === 0 || modListRva + 4 > buf.length) return;
  const moduleCount = Math.min(
    view.getUint32(modListRva, true),
    MAX_ANNOTATION_SCAN,
  );
  for (let i = 0; i < moduleCount; i++) {
    const link = modListRva + 4 + i * 12;
    if (link + 12 > buf.length) break;
    const moduleInfoRva = view.getUint32(link + 8, true);
    if (moduleInfoRva + 28 > buf.length) continue;
    readSimpleDictionary(
      view,
      buf,
      view.getUint32(moduleInfoRva + MODULE_INFO_SIMPLE_RVA_OFF, true),
      out,
    );
    const objectsRva = view.getUint32(
      moduleInfoRva + MODULE_INFO_OBJECTS_RVA_OFF,
      true,
    );
    if (objectsRva === 0 || objectsRva + 4 > buf.length) continue;
    const objectCount = Math.min(
      view.getUint32(objectsRva, true),
      MAX_ANNOTATION_SCAN,
    );
    for (let j = 0; j < objectCount; j++) {
      const obj = objectsRva + 4 + j * 12;
      if (obj + 12 > buf.length) break;
      if (view.getUint16(obj + 4, true) !== ANNOTATION_TYPE_STRING) continue;
      addAnnotation(
        out,
        readLengthPrefixed(view, buf, view.getUint32(obj, true)),
        readLengthPrefixed(view, buf, view.getUint32(obj + 8, true)),
      );
    }
  }
}

function annotationsFull(out: Record<string, string>): boolean {
  return Object.keys(out).length >= MAX_ANNOTATIONS;
}

function addAnnotation(
  out: Record<string, string>,
  key: string,
  value: string,
): void {
  // Truncate before the checks so lookup and storage use the same key.
  const k = key.slice(0, MAX_ANNOTATION_KEY_LEN);
  // First writer wins, so the trusted source (module annotations, read
  // first) cannot be overwritten by a later dictionary.
  if (!k || Object.hasOwn(out, k)) return;
  // ptype drives crash attribution, so the cap never drops it.
  if (annotationsFull(out) && k !== "ptype") return;
  out[k] = value.slice(0, MAX_ANNOTATION_VALUE_LEN);
}
