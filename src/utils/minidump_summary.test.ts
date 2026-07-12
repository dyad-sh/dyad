import { describe, it, expect } from "vitest";
import { parseMinidumpBuffer } from "@/utils/minidump_summary";

// Build a minimal but valid minidump containing only the streams the parser
// reads (module list + exception, and optionally a CrashpadInfo stream with a
// "ptype" annotation), with the instruction pointer placed in a synthetic CPU
// context. Lets us assert parsing deterministically without committing a real
// (memory-bearing) dump.
//
// A minidump is a header, then a stream directory (a table of contents), then
// the stream payloads — all referenced by RVA (an absolute byte offset from the
// start of the file). We can't write the directory until we know where each
// payload landed, so this builds in two passes: first lay the payloads down at
// increasing offsets (tracking each one's RVA), then fill in the header +
// directory that point at them. `cursor` is the running write position; the
// `& ~3` / `& ~7` expressions round it up to 4-/8-byte alignment.
//
// The field offsets used here (e.g. exceptionCode @ +8) are the same ones the
// parser reads — see the struct layouts documented in minidump_summary.ts.
function buildMinidump(opts: {
  modules: { base: bigint; size: number; name: string }[];
  exceptionCode: number;
  exceptionAddress?: bigint;
  exceptionParams?: bigint[]; // info[] values, with numberParameters set to length
  ip: bigint;
  ipOffset: number; // where the IP sits in the CPU context: 248 (x64) / 264 (arm64)
  ptype?: string;
  addressMask?: bigint; // Crashpad address_mask, written into the CrashpadInfo stream
}): Buffer {
  const buf = Buffer.alloc(16384);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // 2 streams (module list + exception), or 3 when a CrashpadInfo stream is
  // included. Payloads start after the 32-byte header + the directory (one
  // 12-byte entry per stream).
  const streamCount = opts.ptype !== undefined ? 3 : 2;
  let cursor = 32 + streamCount * 12;

  // Writes a length-prefixed UTF-8 string (u32 byte-length + bytes) at the
  // cursor and returns its RVA. Used for the Crashpad annotation name/value.
  const writeUtf8 = (s: string): number => {
    const r = cursor;
    const b = Buffer.from(s, "utf8");
    dv.setUint32(r, b.length, true);
    b.copy(buf, r + 4);
    cursor = (r + 4 + b.length + 3) & ~3;
    return r;
  };

  // --- Module name strings (MINIDUMP_STRING: u32 byte-length + UTF-16LE) ---
  // Written first so the module records below can point at them by RVA.
  const nameRvas: number[] = [];
  for (const m of opts.modules) {
    const rva = cursor;
    const u16 = Buffer.from(m.name, "utf16le");
    dv.setUint32(rva, u16.length, true);
    u16.copy(buf, rva + 4);
    cursor = (rva + 4 + u16.length + 3) & ~3;
    nameRvas.push(rva);
  }

  // --- Module list stream (u32 count, then one 108-byte record per module) ---
  // Each record: base @ +0, size @ +8, name RVA @ +20.
  const moduleListRva = cursor;
  dv.setUint32(moduleListRva, opts.modules.length, true);
  let mc = moduleListRva + 4;
  opts.modules.forEach((m, i) => {
    dv.setBigUint64(mc, m.base, true);
    dv.setUint32(mc + 8, m.size, true);
    dv.setUint32(mc + 20, nameRvas[i], true);
    mc += 108;
  });
  const moduleListSize = mc - moduleListRva;
  cursor = mc;

  // --- CPU context ---
  // The parser reads the instruction pointer from here. We only need the IP, so
  // the rest is left zeroed; the IP is placed at the arch-specific ipOffset.
  const contextRva = cursor;
  const contextSize = opts.ipOffset + 8;
  dv.setBigUint64(contextRva + opts.ipOffset, opts.ip, true);
  cursor = (contextRva + contextSize + 7) & ~7;

  // --- Exception stream ---
  // exceptionCode @ +8; exceptionAddress @ +24; numberParameters @ +32 with
  // info[] @ +40; then a location descriptor for the CPU context above
  // (its size @ +160, its RVA @ +164).
  const exceptionRva = cursor;
  dv.setUint32(exceptionRva + 8, opts.exceptionCode, true);
  dv.setBigUint64(exceptionRva + 24, opts.exceptionAddress ?? 0n, true);
  if (opts.exceptionParams) {
    dv.setUint32(exceptionRva + 32, opts.exceptionParams.length, true);
    opts.exceptionParams.forEach((param, i) => {
      dv.setBigUint64(exceptionRva + 40 + i * 8, param, true);
    });
  }
  dv.setUint32(exceptionRva + 160, contextSize, true);
  dv.setUint32(exceptionRva + 164, contextRva, true);
  const exceptionSize = 168;
  cursor = (exceptionRva + exceptionSize + 3) & ~3;

  // --- Optional CrashpadInfo stream carrying one "ptype" annotation ---
  // Mirrors the nested chain the parser walks to find ptype, built bottom-up so
  // each level can reference the RVA of the one below it:
  //   annotation (name + value) -> annotation_objects list -> module_info ->
  //   module_list -> CrashpadInfo.
  let crashpadInfoRva = 0;
  if (opts.ptype !== undefined) {
    const nameRva = writeUtf8("ptype");
    const valueRva = writeUtf8(opts.ptype);

    // annotation_objects: u32 count, then one 12-byte annotation
    // (name RVA @ +0, value RVA @ +8 within the annotation).
    const annObjectsRva = cursor;
    dv.setUint32(annObjectsRva, 1, true);
    dv.setUint32(annObjectsRva + 4, nameRva, true);
    dv.setUint32(annObjectsRva + 12, valueRva, true);
    cursor = annObjectsRva + 16;

    // ModuleCrashpadInfo: annotation_objects RVA @ +24.
    const moduleInfoRva = cursor;
    dv.setUint32(moduleInfoRva + 24, annObjectsRva, true);
    cursor = moduleInfoRva + 28;

    // module_list: u32 count, then one 12-byte link whose module_info RVA @ +8.
    const cpModListRva = cursor;
    dv.setUint32(cpModListRva, 1, true);
    dv.setUint32(cpModListRva + 12, moduleInfoRva, true);
    cursor = cpModListRva + 16;

    // CrashpadInfo: module_list RVA @ +48, optional address_mask u64 @ +56.
    crashpadInfoRva = cursor;
    dv.setUint32(crashpadInfoRva + 48, cpModListRva, true);
    if (opts.addressMask !== undefined) {
      dv.setBigUint64(crashpadInfoRva + 56, opts.addressMask, true);
      cursor = crashpadInfoRva + 64;
    } else {
      cursor = crashpadInfoRva + 52;
    }
  }

  // --- Header (signature @0, stream count @8, directory RVA @12) ---
  dv.setUint32(0, 0x504d444d, true); // "MDMP"
  dv.setUint32(8, streamCount, true);
  dv.setUint32(12, 32, true);

  // --- Stream directory: one 12-byte entry per stream, each being
  // { u32 streamType @0, u32 dataSize @4, u32 rva @8 }, starting at offset 32.
  // [0] module list (type 4), [1] exception (type 6), [2] CrashpadInfo.
  dv.setUint32(32, 4, true);
  dv.setUint32(36, moduleListSize, true);
  dv.setUint32(40, moduleListRva, true);
  dv.setUint32(44, 6, true);
  dv.setUint32(48, exceptionSize, true);
  dv.setUint32(52, exceptionRva, true);
  if (opts.ptype !== undefined) {
    dv.setUint32(56, 0x43500001, true);
    dv.setUint32(60, opts.addressMask !== undefined ? 64 : 52, true);
    dv.setUint32(64, crashpadInfoRva, true);
  }

  return Buffer.from(buf.subarray(0, cursor));
}

const oneModule = [{ base: 0x10000n, size: 0x2000, name: "/lib/libc.so.6" }];

describe("parseMinidumpBuffer", () => {
  it("decodes a POSIX signal and resolves the faulting module via the IP", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11, // SIGSEGV
      ip: 0x10500n, // inside the module (base + 0x500)
      ipOffset: 248,
    });
    const s = parseMinidumpBuffer(dump, "linux", "x64");
    expect(s).not.toBeNull();
    expect(s!.crashReason).toBe("SIGSEGV");
    expect(s!.faultingModule).toBe("libc.so.6");
    expect(s!.faultingOffset).toBe("0x500");
  });

  it("decodes SIGABRT", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 6,
      ip: 0x10010n,
      ipOffset: 248,
    });
    expect(parseMinidumpBuffer(dump, "linux", "x64")!.crashReason).toBe(
      "SIGABRT",
    );
  });

  it("reads the fault address for a POSIX memory fault", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11, // SIGSEGV
      exceptionAddress: 0x18n,
      ip: 0x10010n,
      ipOffset: 248,
    });
    expect(parseMinidumpBuffer(dump, "linux", "x64")!.faultAddress).toBe(
      "0x18",
    );
  });

  it("leaves the fault address undefined for non-memory signals", () => {
    // For SIGABRT the address field carries no meaningful fault address.
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 6,
      exceptionAddress: 0x18n,
      ip: 0x10010n,
      ipOffset: 248,
    });
    expect(
      parseMinidumpBuffer(dump, "linux", "x64")!.faultAddress,
    ).toBeUndefined();
  });

  it("decodes Windows access violation parameters", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 0xc0000005,
      exceptionParams: [1n, 0x18n], // write to address 0x18
      ip: 0x10010n,
      ipOffset: 248,
    });
    const s = parseMinidumpBuffer(dump, "win32", "x64");
    expect(s!.accessType).toBe("write");
    expect(s!.faultAddress).toBe("0x18");
  });

  it("decodes Windows in-page error parameters", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 0xc0000006,
      // read of address 0x18, paging failed with STATUS_DEVICE_DATA_ERROR
      exceptionParams: [0n, 0x18n, 0xc000009cn],
      ip: 0x10010n,
      ipOffset: 248,
    });
    const s = parseMinidumpBuffer(dump, "win32", "x64");
    expect(s!.crashReason).toBe("IN_PAGE_ERROR");
    expect(s!.accessType).toBe("read");
    expect(s!.faultAddress).toBe("0x18");
    expect(s!.inPageErrorStatus).toBe(0xc000009c);
  });

  it("reads the failed allocation size for a Chromium OOM crash", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 0xe0000008,
      // Chromium passes the allocation size and page file state.
      exceptionParams: [2147483648n, 0n, 0n],
      ip: 0x10010n,
      ipOffset: 248,
    });
    expect(
      parseMinidumpBuffer(dump, "win32", "x64")!.oomAllocationSizeBytes,
    ).toBe(2147483648);
  });

  it("reads the FAST_FAIL code for Windows 0xC0000409", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 0xc0000409,
      exceptionParams: [7n], // FAST_FAIL_FATAL_APP_EXIT, i.e. abort()
      ip: 0x10010n,
      ipOffset: 248,
    });
    expect(parseMinidumpBuffer(dump, "win32", "x64")!.fastFailCode).toBe(7);
  });

  it("leaves detail fields undefined when the exception has no parameters", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 0xc0000005,
      ip: 0x10010n,
      ipOffset: 248,
    });
    const s = parseMinidumpBuffer(dump, "win32", "x64");
    expect(s!.accessType).toBeUndefined();
    expect(s!.faultAddress).toBeUndefined();
  });

  it("decodes a macOS Mach exception code (not a POSIX signal)", () => {
    // On macOS, ExceptionCode is a Mach exception type: 1 is EXC_BAD_ACCESS,
    // not signal 1 (SIGHUP).
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 1,
      ip: 0x10010n,
      ipOffset: 264,
    });
    expect(parseMinidumpBuffer(dump, "darwin", "arm64")!.crashReason).toBe(
      "EXC_BAD_ACCESS",
    );
  });

  it("decodes a Windows NTSTATUS code", () => {
    const dump = buildMinidump({
      modules: [{ base: 0x400000n, size: 0x1000, name: "C:\\app\\app.exe" }],
      exceptionCode: 0xc0000005,
      ip: 0x400100n,
      ipOffset: 248,
    });
    const s = parseMinidumpBuffer(dump, "win32", "x64");
    expect(s!.crashReason).toBe("ACCESS_VIOLATION");
    expect(s!.faultingModule).toBe("app.exe");
  });

  it("reads the arm64 IP at the documented offset (264)", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10800n,
      ipOffset: 264,
    });
    const s = parseMinidumpBuffer(dump, "darwin", "arm64");
    expect(s!.faultingModule).toBe("libc.so.6");
    expect(s!.faultingOffset).toBe("0x800");
  });

  it("strips arm64 pointer-tag bits using the Crashpad address_mask", () => {
    // IP carries a high tag byte (0xab...); without masking it falls outside the
    // module. address_mask marks the tag bits — clearing them (pointer & ~mask)
    // recovers base + 0x800.
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0xab00000000010800n,
      ipOffset: 264,
      ptype: "browser",
      addressMask: 0xff00000000000000n,
    });
    const s = parseMinidumpBuffer(dump, "darwin", "arm64");
    expect(s!.faultingModule).toBe("libc.so.6");
    expect(s!.faultingOffset).toBe("0x800");
  });

  it("omits the module when the IP is outside every module", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x99999999n,
      ipOffset: 248,
    });
    const s = parseMinidumpBuffer(dump, "linux", "x64");
    expect(s!.crashReason).toBe("SIGSEGV");
    expect(s!.faultingModule).toBeUndefined();
  });

  it("returns the raw code when the signal is unmapped", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 99,
      ip: 0x10010n,
      ipOffset: 248,
    });
    const s = parseMinidumpBuffer(dump, "linux", "x64");
    expect(s!.crashReason).toBeUndefined();
    expect(s!.exceptionCode).toBe(99);
  });

  it("reads the crashing process type (ptype) from the CrashpadInfo stream", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10010n,
      ipOffset: 248,
      ptype: "browser",
    });
    expect(parseMinidumpBuffer(dump, "linux", "x64")!.ptype).toBe("browser");
  });

  it("leaves ptype undefined when there is no CrashpadInfo stream", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10010n,
      ipOffset: 248,
    });
    expect(parseMinidumpBuffer(dump, "linux", "x64")!.ptype).toBeUndefined();
  });

  it("rejects a buffer without the MDMP signature", () => {
    expect(parseMinidumpBuffer(Buffer.alloc(64), "linux", "x64")).toBeNull();
  });

  it("rejects a truncated buffer", () => {
    expect(parseMinidumpBuffer(Buffer.alloc(8), "linux", "x64")).toBeNull();
  });
});
