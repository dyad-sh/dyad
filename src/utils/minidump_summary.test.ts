import { describe, it, expect } from "vitest";
import {
  browserCrashAttribution,
  cleanModuleName,
  parseMinidumpBuffer,
  type MinidumpSummary,
} from "@/utils/minidump_summary";

// A thread's captured stack in the crashed process: `words` are its
// 8-byte slots starting at address `start`, and `sp` is its stack pointer.
interface TestStack {
  start: bigint;
  words: bigint[];
  sp: bigint;
}

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
  // CodeView record attached to the first module.
  cvRecord?:
    | { kind: "pdb70"; guid: number[]; age: number; name: string }
    | { kind: "build-id"; bytes: number[] };
  exceptionCode: number;
  exceptionFlags?: number; // si_code on Linux dumps
  exceptionAddress?: bigint;
  exceptionParams?: bigint[]; // info[] values, with numberParameters set to length
  ip: bigint;
  ipOffset: number; // where the IP sits in the CPU context: 248 (x64) / 264 (arm64)
  ptype?: string;
  addressMask?: bigint; // Crashpad address_mask, written into the CrashpadInfo stream
  annotations?: Record<string, string>; // module annotation objects beyond ptype
  annotationType?: number; // type written on annotation objects, default 1 (string)
  simpleAnnotations?: Record<string, string>; // process-level dictionary
  moduleSimpleAnnotations?: Record<string, string>; // module-level dictionary
  // The crashing thread's stack, written as a ThreadList stream. The
  // exception stream names thread 7, so a different threadId tests the
  // lookup. sp and lr land in the exception's CPU context.
  stack?: TestStack & { threadId?: number; lr?: bigint };
  // Another thread listed ahead of the crashing one, which makes it the
  // main thread. It gets its own CPU context holding its ip and sp.
  mainThread?: TestStack & { threadId: number; ip: bigint };
  spOffset?: number; // where sp sits in a CPU context: 152 (x64, default) / 256 (arm64)
  processorArchitecture?: number; // written as a SystemInfo stream when set
  systemInfoSize?: number; // the size its directory entry declares, default 56
  exceptionContextSize?: number; // the size the exception's context descriptor declares
}): Buffer {
  const buf = Buffer.alloc(16384);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Module list + exception, plus CrashpadInfo, thread list and SystemInfo
  // streams when their options are set. Payloads start after the 32-byte
  // header + the directory (one 12-byte entry per stream).
  const objectAnnotations: [string, string][] = [
    ...(opts.ptype !== undefined
      ? ([["ptype", opts.ptype]] as [string, string][])
      : []),
    ...Object.entries(opts.annotations ?? {}),
  ];
  const hasCrashpadInfo =
    objectAnnotations.length > 0 ||
    opts.simpleAnnotations !== undefined ||
    opts.moduleSimpleAnnotations !== undefined ||
    opts.addressMask !== undefined;
  const hasThreadList =
    opts.stack !== undefined || opts.mainThread !== undefined;
  const hasSystemInfo = opts.processorArchitecture !== undefined;
  const streamCount =
    2 +
    (hasCrashpadInfo ? 1 : 0) +
    (hasThreadList ? 1 : 0) +
    (hasSystemInfo ? 1 : 0);
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

  // --- Optional CodeView record for the first module ---
  // pdb70: "RSDS" + GUID (16) + u32 age + NUL-terminated name.
  // build-id: "BpEL" + raw build id bytes.
  let cvRva = 0;
  let cvSize = 0;
  if (opts.cvRecord) {
    cvRva = cursor;
    if (opts.cvRecord.kind === "pdb70") {
      // 0x53445352 is "RSDS" as a little endian u32.
      dv.setUint32(cvRva, 0x53445352, true);
      opts.cvRecord.guid.forEach((b, i) => buf.writeUInt8(b, cvRva + 4 + i));
      dv.setUint32(cvRva + 20, opts.cvRecord.age, true);
      const nameBytes = Buffer.from(opts.cvRecord.name, "utf8");
      nameBytes.copy(buf, cvRva + 24);
      cvSize = 24 + nameBytes.length + 1;
    } else {
      // 0x4270454c is Crashpad's ELF build id signature.
      dv.setUint32(cvRva, 0x4270454c, true);
      opts.cvRecord.bytes.forEach((b, i) => buf.writeUInt8(b, cvRva + 4 + i));
      cvSize = 4 + opts.cvRecord.bytes.length;
    }
    cursor = (cvRva + cvSize + 3) & ~3;
  }

  // --- Module list stream (u32 count, then one 108-byte record per module) ---
  // Each record: base @ +0, size @ +8, name RVA @ +20, CvRecord @ +76/+80.
  const moduleListRva = cursor;
  dv.setUint32(moduleListRva, opts.modules.length, true);
  let mc = moduleListRva + 4;
  opts.modules.forEach((m, i) => {
    dv.setBigUint64(mc, m.base, true);
    dv.setUint32(mc + 8, m.size, true);
    dv.setUint32(mc + 20, nameRvas[i], true);
    if (i === 0 && cvRva !== 0) {
      dv.setUint32(mc + 76, cvSize, true);
      dv.setUint32(mc + 80, cvRva, true);
    }
    mc += 108;
  });
  const moduleListSize = mc - moduleListRva;
  cursor = mc;

  // --- CPU context ---
  // The parser reads the instruction pointer from here. We only need the IP, so
  // the rest is left zeroed; the IP is placed at the arch-specific ipOffset.
  const spOffset = opts.spOffset ?? 152;
  const contextSize = Math.max(opts.ipOffset, spOffset, 248) + 8;
  const contextRva = cursor;
  dv.setBigUint64(contextRva + opts.ipOffset, opts.ip, true);
  if (opts.stack) {
    dv.setBigUint64(contextRva + spOffset, opts.stack.sp, true);
    if (opts.stack.lr !== undefined) {
      dv.setBigUint64(contextRva + 248, opts.stack.lr, true);
    }
  }
  cursor = (contextRva + contextSize + 7) & ~7;

  // --- Optional thread list stream ---
  // Each thread's stack bytes (and the main thread's context) first, then
  // u32 count + one 48-byte MINIDUMP_THREAD per thread: threadId @ +0,
  // stack start address @ +24, stack size @ +32, stack RVA @ +36, context
  // size @ +40, context RVA @ +44. The main thread is listed first.
  let threadListRva = 0;
  let threadListSize = 0;
  if (hasThreadList) {
    const records: {
      id: number;
      stack?: TestStack;
      stackRva: number;
      contextRva: number;
    }[] = [];
    const writeStack = (stack: TestStack): number => {
      const rva = cursor;
      stack.words.forEach((w, i) => dv.setBigUint64(rva + i * 8, w, true));
      cursor = rva + stack.words.length * 8;
      return rva;
    };
    if (opts.mainThread) {
      const mainContextRva = cursor;
      dv.setBigUint64(mainContextRva + opts.ipOffset, opts.mainThread.ip, true);
      dv.setBigUint64(mainContextRva + spOffset, opts.mainThread.sp, true);
      cursor = mainContextRva + contextSize;
      records.push({
        id: opts.mainThread.threadId,
        stack: opts.mainThread,
        stackRva: writeStack(opts.mainThread),
        contextRva: mainContextRva,
      });
    }
    if (opts.stack) {
      records.push({
        id: opts.stack.threadId ?? 7,
        stack: opts.stack,
        stackRva: writeStack(opts.stack),
        // Crashpad gives the crashing thread a context too; the parser
        // reads the exception's instead.
        contextRva,
      });
    }
    threadListRva = cursor;
    dv.setUint32(threadListRva, records.length, true);
    records.forEach((r, i) => {
      const t = threadListRva + 4 + i * 48;
      dv.setUint32(t, r.id, true);
      if (r.stack) {
        dv.setBigUint64(t + 24, r.stack.start, true);
        dv.setUint32(t + 32, r.stack.words.length * 8, true);
        dv.setUint32(t + 36, r.stackRva, true);
      }
      dv.setUint32(t + 40, contextSize, true);
      dv.setUint32(t + 44, r.contextRva, true);
    });
    threadListSize = 4 + records.length * 48;
    cursor = threadListRva + threadListSize;
  }

  // --- Exception stream ---
  // exceptionCode @ +8; exceptionFlags @ +12; exceptionAddress @ +24;
  // numberParameters @ +32 with info[] @ +40; then a location descriptor
  // for the CPU context above (its size @ +160, its RVA @ +164).
  const exceptionRva = cursor;
  dv.setUint32(exceptionRva, 7, true); // crashing thread id
  dv.setUint32(exceptionRva + 8, opts.exceptionCode, true);
  dv.setUint32(exceptionRva + 12, opts.exceptionFlags ?? 0, true);
  dv.setBigUint64(exceptionRva + 24, opts.exceptionAddress ?? 0n, true);
  if (opts.exceptionParams) {
    if (opts.exceptionParams.length > 15) {
      throw new Error(
        "info[] holds at most 15 params; more would overwrite the context descriptor",
      );
    }
    dv.setUint32(exceptionRva + 32, opts.exceptionParams.length, true);
    opts.exceptionParams.forEach((param, i) => {
      dv.setBigUint64(exceptionRva + 40 + i * 8, param, true);
    });
  }
  dv.setUint32(
    exceptionRva + 160,
    opts.exceptionContextSize ?? contextSize,
    true,
  );
  dv.setUint32(exceptionRva + 164, contextRva, true);
  const exceptionSize = 168;
  cursor = (exceptionRva + exceptionSize + 3) & ~3;

  // --- Optional CrashpadInfo stream carrying annotations ---
  // Mirrors the nested chain the parser walks, built bottom-up so each level
  // can reference the RVA of the one below it:
  //   annotation (name + type + value) -> annotation_objects list ->
  //   module_info -> module_list -> CrashpadInfo, plus an optional
  //   process-level simple annotations dictionary.
  let crashpadInfoRva = 0;
  if (hasCrashpadInfo) {
    // annotation_objects: u32 count, then 12-byte annotations
    // (name RVA @ +0, u16 type @ +4, value RVA @ +8).
    let annObjectsRva = 0;
    if (objectAnnotations.length > 0) {
      const entries = objectAnnotations.map(
        ([name, value]) => [writeUtf8(name), writeUtf8(value)] as const,
      );
      annObjectsRva = cursor;
      dv.setUint32(annObjectsRva, entries.length, true);
      entries.forEach(([nameRva, valueRva], i) => {
        const obj = annObjectsRva + 4 + i * 12;
        dv.setUint32(obj, nameRva, true);
        dv.setUint16(obj + 4, opts.annotationType ?? 1, true);
        dv.setUint32(obj + 8, valueRva, true);
      });
      cursor = annObjectsRva + 4 + entries.length * 12;
    }

    // Module-level simple annotations dictionary: same layout as the
    // process-level one below.
    let moduleSimpleRva = 0;
    if (opts.moduleSimpleAnnotations) {
      const entries = Object.entries(opts.moduleSimpleAnnotations).map(
        ([key, value]) => [writeUtf8(key), writeUtf8(value)] as const,
      );
      moduleSimpleRva = cursor;
      dv.setUint32(moduleSimpleRva, entries.length, true);
      entries.forEach(([keyRva, valueRva], i) => {
        dv.setUint32(moduleSimpleRva + 4 + i * 8, keyRva, true);
        dv.setUint32(moduleSimpleRva + 8 + i * 8, valueRva, true);
      });
      cursor = moduleSimpleRva + 4 + entries.length * 8;
    }

    // ModuleCrashpadInfo: simple_annotations RVA @ +16,
    // annotation_objects RVA @ +24.
    const moduleInfoRva = cursor;
    dv.setUint32(moduleInfoRva + 16, moduleSimpleRva, true);
    dv.setUint32(moduleInfoRva + 24, annObjectsRva, true);
    cursor = moduleInfoRva + 28;

    // module_list: u32 count, then one 12-byte link whose module_info RVA @ +8.
    const cpModListRva = cursor;
    dv.setUint32(cpModListRva, 1, true);
    dv.setUint32(cpModListRva + 12, moduleInfoRva, true);
    cursor = cpModListRva + 16;

    // Simple annotations dictionary: u32 count, then 8-byte entries of
    // (key RVA @ +0, value RVA @ +4).
    let simpleRva = 0;
    if (opts.simpleAnnotations) {
      const entries = Object.entries(opts.simpleAnnotations).map(
        ([key, value]) => [writeUtf8(key), writeUtf8(value)] as const,
      );
      simpleRva = cursor;
      dv.setUint32(simpleRva, entries.length, true);
      entries.forEach(([keyRva, valueRva], i) => {
        dv.setUint32(simpleRva + 4 + i * 8, keyRva, true);
        dv.setUint32(simpleRva + 8 + i * 8, valueRva, true);
      });
      cursor = simpleRva + 4 + entries.length * 8;
    }

    // CrashpadInfo: simple_annotations RVA @ +40, module_list RVA @ +48,
    // optional address_mask u64 @ +56.
    crashpadInfoRva = cursor;
    dv.setUint32(crashpadInfoRva + 40, simpleRva, true);
    dv.setUint32(crashpadInfoRva + 48, cpModListRva, true);
    if (opts.addressMask !== undefined) {
      dv.setBigUint64(crashpadInfoRva + 56, opts.addressMask, true);
      cursor = crashpadInfoRva + 64;
    } else {
      cursor = crashpadInfoRva + 52;
    }
  }

  // --- Optional SystemInfo stream: u16 ProcessorArchitecture @0 of 56 bytes ---
  let systemInfoRva = 0;
  if (hasSystemInfo) {
    systemInfoRva = cursor;
    dv.setUint16(systemInfoRva, opts.processorArchitecture!, true);
    cursor = systemInfoRva + 56;
  }

  // --- Header (signature @0, stream count @8, directory RVA @12) ---
  dv.setUint32(0, 0x504d444d, true); // "MDMP"
  dv.setUint32(8, streamCount, true);
  dv.setUint32(12, 32, true);

  // --- Stream directory: one 12-byte entry per stream, each being
  // { u32 streamType @0, u32 dataSize @4, u32 rva @8 }, starting at offset 32.
  // [0] module list (type 4), [1] exception (type 6), then CrashpadInfo,
  // the thread list and SystemInfo, each only when present.
  dv.setUint32(32, 4, true);
  dv.setUint32(36, moduleListSize, true);
  dv.setUint32(40, moduleListRva, true);
  dv.setUint32(44, 6, true);
  dv.setUint32(48, exceptionSize, true);
  dv.setUint32(52, exceptionRva, true);
  let entry = 56;
  const addEntry = (type: number, size: number, rva: number) => {
    dv.setUint32(entry, type, true);
    dv.setUint32(entry + 4, size, true);
    dv.setUint32(entry + 8, rva, true);
    entry += 12;
  };
  if (hasCrashpadInfo) {
    addEntry(
      0x43500001,
      opts.addressMask !== undefined ? 64 : 52,
      crashpadInfoRva,
    );
  }
  if (hasThreadList) addEntry(3, threadListSize, threadListRva);
  if (hasSystemInfo) addEntry(7, opts.systemInfoSize ?? 56, systemInfoRva);

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

  it("omits the fault address for Linux kernel-origin faults", () => {
    // A general protection fault (e.g. from a non-canonical address)
    // arrives as SIGSEGV with SI_KERNEL and si_addr 0. Reporting that 0
    // would disguise pointer corruption as a null dereference.
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11, // SIGSEGV
      exceptionFlags: 0x80, // SI_KERNEL
      exceptionAddress: 0n,
      ip: 0x10010n,
      ipOffset: 248,
    });
    expect(
      parseMinidumpBuffer(dump, "linux", "x64")!.faultAddress,
    ).toBeUndefined();
  });

  it("omits the fault address for macOS general protection faults", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 1, // EXC_BAD_ACCESS
      exceptionParams: [1n, 13n, 0n], // code0 13 is EXC_I386_GPFLT
      // Crashpad stores the instruction pointer here, not a data address.
      exceptionAddress: 0x10010n,
      ip: 0x10010n,
      ipOffset: 248,
    });
    expect(
      parseMinidumpBuffer(dump, "darwin", "x64")!.faultAddress,
    ).toBeUndefined();
  });

  it("omits the fault address for macOS read|execute protection collisions", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 1, // EXC_BAD_ACCESS
      exceptionParams: [1n, 5n, 0n], // code0 5 is VM_PROT_READ | VM_PROT_EXECUTE
      // Crashpad stores the instruction pointer here, not a data address.
      exceptionAddress: 0x10010n,
      ip: 0x10010n,
      ipOffset: 248,
    });
    expect(
      parseMinidumpBuffer(dump, "darwin", "x64")!.faultAddress,
    ).toBeUndefined();
  });

  it("reports a zero fault address for null pointer dereferences", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11, // SIGSEGV
      exceptionAddress: 0n,
      ip: 0x10010n,
      ipOffset: 248,
    });
    expect(parseMinidumpBuffer(dump, "linux", "x64")!.faultAddress).toBe("0x0");
  });

  it("reduces a POSIX fault address past the null page to non-null", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11, // SIGSEGV
      exceptionAddress: 0x7f3a91c2b418n,
      ip: 0x10010n,
      ipOffset: 248,
    });
    expect(parseMinidumpBuffer(dump, "linux", "x64")!.faultAddress).toBe(
      "non-null",
    );
  });

  it("strips arm64 tag bits from the fault address using the address mask", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 1, // EXC_BAD_ACCESS
      exceptionAddress: 0xb400000000000018n, // tagged pointer to 0x18
      ip: 0x10010n,
      ipOffset: 264,
      ptype: "browser",
      addressMask: 0xff00000000000000n,
    });
    expect(parseMinidumpBuffer(dump, "darwin", "arm64")!.faultAddress).toBe(
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

  it("reduces a Windows fault address past the null page to non-null", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 0xc0000005,
      exceptionParams: [0n, 0x7f3a91c2b418n], // read of a heap-range address
      ip: 0x10010n,
      ipOffset: 248,
    });
    const s = parseMinidumpBuffer(dump, "win32", "x64");
    expect(s!.accessType).toBe("read");
    expect(s!.faultAddress).toBe("non-null");
  });

  it("leaves accessType undefined for unknown access type values", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 0xc0000005,
      exceptionParams: [5n, 0x18n], // 5 is not a documented access type
      ip: 0x10010n,
      ipOffset: 248,
    });
    const s = parseMinidumpBuffer(dump, "win32", "x64");
    expect(s!.accessType).toBeUndefined();
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
    expect(s!.inPageErrorStatus).toBe("0xc000009c");
  });

  it("masks a sign-extended in-page error status to 32 bits", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 0xc0000006,
      // The negative NTSTATUS sign extends into the 64-bit slot.
      exceptionParams: [0n, 0x18n, 0xffffffffc000009cn],
      ip: 0x10010n,
      ipOffset: 248,
    });
    expect(parseMinidumpBuffer(dump, "win32", "x64")!.inPageErrorStatus).toBe(
      "0xc000009c",
    );
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

  it("decodes Chromium's Windows OOM exception code", () => {
    // 0xE0000008 is kOomExceptionCode, raised only when a process is
    // terminated because an allocation failed.
    const dump = buildMinidump({
      modules: [{ base: 0x400000n, size: 0x1000, name: "C:\\app\\app.exe" }],
      exceptionCode: 0xe0000008,
      ip: 0x400100n,
      ipOffset: 248,
    });
    const s = parseMinidumpBuffer(dump, "win32", "x64");
    expect(s!.crashReason).toBe("OUT_OF_MEMORY");
    expect(s!.exceptionCode).toBe(0xe0000008);
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

  it("reads registers for the CPU the dump records, not the running one", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10800n,
      ipOffset: 248,
      stack: { start: 0x7000n, words: [0x10900n], sp: 0x7000n },
      processorArchitecture: 9, // AMD64
    });
    const s = parseMinidumpBuffer(dump, "darwin", "arm64", {
      stackTrace: true,
    });
    expect(s!.faultingOffset).toBe("0x800");
    expect(s!.stackTrace!.threads[0].frames).toEqual([
      { module: 0, offset: "0x800" },
      { module: 0, offset: "0x900" },
    ]);
  });

  it("ignores a SystemInfo stream too short to hold the CPU", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10800n,
      ipOffset: 264,
      processorArchitecture: 9, // AMD64, but the stream claims 0 bytes
      systemInfoSize: 0,
    });
    expect(parseMinidumpBuffer(dump, "darwin", "arm64")!.faultingOffset).toBe(
      "0x800",
    );
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

  it("extracts the debug identity from a pdb70 CodeView record", () => {
    const dump = buildMinidump({
      modules: [{ base: 0x400000n, size: 0x1000, name: "C:\\app\\dyad.exe" }],
      cvRecord: {
        kind: "pdb70",
        // Little endian GUID fields print big endian, so bytes
        // 01 23 45 67 come out as 67452301 in the expected id.
        guid: [
          0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45,
          0x67, 0x89, 0xab, 0xcd, 0xef,
        ],
        age: 1,
        name: "C:\\out\\electron.exe.pdb",
      },
      exceptionCode: 0xc0000005,
      ip: 0x400100n,
      ipOffset: 248,
    });
    const s = parseMinidumpBuffer(dump, "win32", "x64");
    expect(s!.faultingModule).toBe("dyad.exe");
    expect(s!.faultingDebugFile).toBe("electron.exe.pdb");
    expect(s!.faultingDebugId).toBe("67452301AB89EFCD0123456789ABCDEF1");
  });

  it("extracts the debug identity from an ELF build id record", () => {
    // Real values from a retained production dump: the id is the build id's
    // first 16 bytes GUID-swapped with age 0, and the file name falls back
    // to the module name.
    const dump = buildMinidump({
      modules: oneModule,
      cvRecord: {
        kind: "build-id",
        bytes: [
          0x90, 0xc4, 0x23, 0xdf, 0x7c, 0x7a, 0x1b, 0x23, 0xea, 0x2d, 0x19,
          0x62, 0xbe, 0xd7, 0x25, 0x29,
        ],
      },
      exceptionCode: 11,
      ip: 0x10500n,
      ipOffset: 248,
    });
    const s = parseMinidumpBuffer(dump, "linux", "x64");
    expect(s!.faultingDebugId).toBe("DF23C4907A7C231BEA2D1962BED725290");
    expect(s!.faultingDebugFile).toBe("libc.so.6");
  });

  it("zero pads short ELF build ids", () => {
    const dump = buildMinidump({
      modules: oneModule,
      cvRecord: { kind: "build-id", bytes: [0x90, 0xc4, 0x23, 0xdf] },
      exceptionCode: 11,
      ip: 0x10500n,
      ipOffset: 248,
    });
    expect(parseMinidumpBuffer(dump, "linux", "x64")!.faultingDebugId).toBe(
      "DF23C4900000000000000000000000000",
    );
  });

  it("leaves the debug identity undefined without a CodeView record", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10500n,
      ipOffset: 248,
    });
    const s = parseMinidumpBuffer(dump, "linux", "x64");
    expect(s!.faultingDebugId).toBeUndefined();
    expect(s!.faultingDebugFile).toBeUndefined();
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

  it("collects all module annotation objects, not just ptype", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10010n,
      ipOffset: 248,
      ptype: "browser",
      annotations: { "oom-size": "2048", "gpu-status": "enabled" },
    });
    const s = parseMinidumpBuffer(dump, "linux", "x64");
    expect(s!.ptype).toBe("browser");
    expect(s!.annotations).toEqual({
      ptype: "browser",
      "oom-size": "2048",
      "gpu-status": "enabled",
    });
  });

  it("collects the process-level simple annotations dictionary", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10010n,
      ipOffset: 248,
      simpleAnnotations: { app_version: "1.2.3", os: "linux" },
    });
    const s = parseMinidumpBuffer(dump, "linux", "x64");
    expect(s!.annotations).toEqual({ app_version: "1.2.3", os: "linux" });
    expect(s!.ptype).toBeUndefined();
  });

  it("skips annotation objects that are not string typed", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10010n,
      ipOffset: 248,
      annotations: { blob: "binary-bytes" },
      annotationType: 3,
    });
    expect(parseMinidumpBuffer(dump, "linux", "x64")!.annotations).toBe(
      undefined,
    );
  });

  it("caps annotation count and value length", () => {
    const many: Record<string, string> = { long: "x".repeat(600) };
    for (let i = 0; i < 40; i++) {
      many[`key${i}`] = "v";
    }
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10010n,
      ipOffset: 248,
      simpleAnnotations: many,
    });
    const annotations = parseMinidumpBuffer(dump, "linux", "x64")!.annotations;
    expect(Object.keys(annotations!)).toHaveLength(32);
    expect(annotations!.long).toHaveLength(512);
  });

  it("keeps ptype when the cap fills across both annotation sources", () => {
    // ptype is a module annotation object and the summary depends on it,
    // so it must win over a cap's worth of simple annotations.
    const many: Record<string, string> = {};
    for (let i = 0; i < 40; i++) {
      many[`key${i}`] = "v";
    }
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10010n,
      ipOffset: 248,
      ptype: "browser",
      simpleAnnotations: many,
    });
    const summary = parseMinidumpBuffer(dump, "linux", "x64")!;
    expect(summary.ptype).toBe("browser");
    expect(Object.keys(summary.annotations!)).toHaveLength(32);
  });

  it("keeps a ptype that sits past the cap in the module annotations", () => {
    // ptype is exempt from the cap, so it survives even as the last of
    // 33 module annotation objects.
    const many: Record<string, string> = {};
    for (let i = 0; i < 32; i++) {
      many[`key${i}`] = "v";
    }
    many.ptype = "browser";
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10010n,
      ipOffset: 248,
      annotations: many,
    });
    const summary = parseMinidumpBuffer(dump, "linux", "x64")!;
    expect(summary.ptype).toBe("browser");
  });

  it("keeps allowlisted keys behind a cap's worth of unknown keys", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 32; i++) {
      many[`key${i}`] = "v";
    }
    many["electron.v8-oom.is_heap_oom"] = "1";
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10010n,
      ipOffset: 248,
      annotations: many,
    });
    const summary = parseMinidumpBuffer(dump, "linux", "x64")!;
    expect(summary.annotations!["electron.v8-oom.is_heap_oom"]).toBe("1");
  });

  it("collects a module's simple annotations dictionary", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10010n,
      ipOffset: 248,
      ptype: "renderer",
      moduleSimpleAnnotations: { "module-key": "module-value" },
      simpleAnnotations: { "process-key": "process-value" },
    });
    const annotations = parseMinidumpBuffer(dump, "linux", "x64")!.annotations!;
    expect(annotations["module-key"]).toBe("module-value");
    expect(annotations["process-key"]).toBe("process-value");
    expect(annotations.ptype).toBe("renderer");
  });

  it("keeps the module annotation when a simple annotation repeats the key", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10010n,
      ipOffset: 248,
      ptype: "browser",
      simpleAnnotations: { ptype: "impostor" },
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

  it("rejects an exception stream whose declared size is too small", () => {
    const dump = buildMinidump({
      modules: oneModule,
      exceptionCode: 11,
      ip: 0x10500n,
      ipOffset: 248,
    });
    // Corrupt the directory: entry [1] is the exception stream, dataSize @48.
    const dv = new DataView(dump.buffer, dump.byteOffset, dump.byteLength);
    dv.setUint32(48, 40, true);
    expect(parseMinidumpBuffer(dump, "linux", "x64")).toBeNull();
  });

  it("rejects a buffer without the MDMP signature", () => {
    expect(parseMinidumpBuffer(Buffer.alloc(64), "linux", "x64")).toBeNull();
  });

  it("rejects a truncated buffer", () => {
    expect(parseMinidumpBuffer(Buffer.alloc(8), "linux", "x64")).toBeNull();
  });
});

describe("browserCrashAttribution", () => {
  const summary = (ptype?: string): MinidumpSummary => ({
    exceptionCode: 0xe0000008,
    ptype,
  });

  it("attributes a browser-ptype dump regardless of the sentinel", () => {
    expect(browserCrashAttribution(summary("browser"), false)).toBe("ptype");
    expect(browserCrashAttribution(summary("browser"), true)).toBe("ptype");
  });

  it("attributes a ptype-less dump only when the sentinel detected a crash", () => {
    // Annotation-stripped dump (e.g. a Windows main-process OOM): the
    // sentinel is the only remaining evidence of whose crash this was.
    expect(browserCrashAttribution(summary(undefined), true)).toBe("sentinel");
    expect(browserCrashAttribution(summary(undefined), false)).toBeNull();
  });

  it("never attributes a child-process dump, even with the sentinel", () => {
    expect(browserCrashAttribution(summary("renderer"), true)).toBeNull();
    expect(browserCrashAttribution(summary("gpu-process"), true)).toBeNull();
    expect(browserCrashAttribution(summary("utility"), false)).toBeNull();
  });

  it("reads Electron's process_type key when ptype is stripped", () => {
    const withProcessType = (value: string): MinidumpSummary => ({
      exceptionCode: 0xe0000008,
      annotations: { process_type: value },
    });
    expect(browserCrashAttribution(withProcessType("browser"), false)).toBe(
      "ptype",
    );
    // A surviving child label blocks the sentinel fallback.
    expect(
      browserCrashAttribution(withProcessType("renderer"), true),
    ).toBeNull();
  });

  it("treats an empty ptype as absent", () => {
    expect(browserCrashAttribution(summary(""), true)).toBe("sentinel");
    expect(browserCrashAttribution(summary(""), false)).toBeNull();
  });
});

describe("stack scan", () => {
  const appModules = [
    { base: 0x100000n, size: 0x10000, name: "/opt/Dyad/dyad" },
    { base: 0x200000n, size: 0x1000, name: "/opt/Dyad/libffmpeg.so" },
    { base: 0x300000n, size: 0x1000, name: "/usr/lib/libc.so.6" },
    { base: 0x400000n, size: 0x1000, name: "/home/u/.hooks/libspy.so" },
  ];

  type Options = Parameters<typeof buildMinidump>[0];
  const scan = (
    overrides: Partial<Options>,
    arch: NodeJS.Architecture = "x64",
  ) =>
    parseMinidumpBuffer(
      buildMinidump({
        modules: appModules,
        exceptionCode: 11,
        ip: 0x100500n,
        ipOffset: arch === "arm64" ? 264 : 248,
        ...overrides,
      }),
      "linux",
      arch,
      { stackTrace: true },
    )!.stackTrace;

  const stack = (words: bigint[], sp = 0x7000n) => ({
    start: 0x7000n,
    sp,
    words,
  });

  it("is only scanned on request", () => {
    const summary = parseMinidumpBuffer(
      buildMinidump({
        modules: appModules,
        exceptionCode: 11,
        ip: 0x100500n,
        ipOffset: 248,
        stack: stack([0x100a10n]),
      }),
      "linux",
      "x64",
    );
    expect(summary!.stackTrace).toBeUndefined();
    expect(summary!.faultingModule).toBe("dyad");
  });

  it("keeps the IP, then stack values that point into any module", () => {
    const trace = scan({
      stack: stack([
        0x100a10n, // return into the executable
        0x12345n, // a plain integer
        0x300020n, // return into libc
        0x7ff0001n, // a heap pointer
        0x400040n, // return into a library from anywhere
      ]),
    });
    expect(trace).toEqual({
      modules: [
        { name: "dyad", debugFile: "dyad", debugId: undefined },
        { name: "libc.so.6", debugFile: "libc.so.6", debugId: undefined },
        { name: "libspy.so", debugFile: "libspy.so", debugId: undefined },
      ],
      threads: [
        {
          crashing: true,
          main: true,
          frames: [
            { module: 0, offset: "0x500" },
            { module: 0, offset: "0xa10" },
            { module: 1, offset: "0x20" },
            { module: 2, offset: "0x40" },
          ],
        },
      ],
    });
  });

  it("starts the scan at the stack pointer", () => {
    // The first word sits below SP: left over from a call that returned.
    const trace = scan({ stack: stack([0x100a10n, 0x100b20n], 0x7008n) });
    expect(trace!.threads[0].frames).toEqual([
      { module: 0, offset: "0x500" },
      { module: 0, offset: "0xb20" },
    ]);
  });

  it("skips repeated values", () => {
    const trace = scan({ stack: stack([0x100a10n, 0x100a10n, 0x100500n]) });
    expect(trace!.threads[0].frames).toEqual([
      { module: 0, offset: "0x500" },
      { module: 0, offset: "0xa10" },
    ]);
  });

  it("caps each thread at 64 frames", () => {
    const words = Array.from({ length: 80 }, (_, i) => 0x100000n + BigInt(i));
    expect(scan({ stack: stack(words) })!.threads[0].frames).toHaveLength(64);
  });

  it('reports an IP outside every module as "unknown"', () => {
    const trace = scan({ ip: 0x9990000n, stack: stack([0x100a10n]) });
    expect(trace!.threads[0].frames).toEqual([
      "unknown",
      { module: 0, offset: "0xa10" },
    ]);
  });

  it('reports a zero IP, as from calling a null function, as "unknown"', () => {
    const trace = scan({ ip: 0n, stack: stack([0x100a10n]) });
    expect(trace!.threads[0].frames).toEqual([
      "unknown",
      { module: 0, offset: "0xa10" },
    ]);
  });

  it("reads no registers past the size the context declares", () => {
    // The bytes after a short context belong to something else, so the
    // zero found where the IP would be is not reported as a frame.
    const dump = buildMinidump({
      modules: [{ base: 0x100000n, size: 0x10000, name: "/opt/dyad/dyad" }],
      exceptionCode: 11,
      ip: 0n,
      ipOffset: 248,
      stack: stack([0x100a10n]),
      exceptionContextSize: 16,
    });
    const s = parseMinidumpBuffer(dump, "linux", "x64", { stackTrace: true });
    expect(s!.stackTrace!.threads[0].frames).toEqual([]);
  });

  it("scans nothing when the whole capture is below the stack pointer", () => {
    const trace = scan({ stack: stack([0x100a10n], 0x9000n) });
    expect(trace!.threads[0].frames).toEqual([{ module: 0, offset: "0x500" }]);
  });

  it("scans the whole capture when it is above the stack pointer", () => {
    const trace = scan({ stack: stack([0x100a10n], 0x6000n) });
    expect(trace!.threads[0].frames).toEqual([
      { module: 0, offset: "0x500" },
      { module: 0, offset: "0xa10" },
    ]);
  });

  it("scans nothing when the context ends before the IP", () => {
    // 160 bytes hold the x64 stack pointer (152) but not the IP (248).
    const dump = buildMinidump({
      modules: [{ base: 0x100000n, size: 0x10000, name: "/opt/dyad/dyad" }],
      exceptionCode: 11,
      ip: 0x100500n,
      ipOffset: 248,
      stack: stack([0x100a10n]),
      exceptionContextSize: 160,
    });
    const s = parseMinidumpBuffer(dump, "linux", "x64", { stackTrace: true });
    expect(s!.stackTrace!.threads[0].frames).toEqual([]);
  });

  it("keeps the IP when the crashing thread is not in the list", () => {
    const trace = scan({ stack: { ...stack([0x100a10n]), threadId: 99 } });
    // Without its record there is no stack to scan. Thread 99, listed
    // first, is the main thread and is scanned on its own.
    expect(trace!.threads[0]).toEqual({
      crashing: true,
      main: false,
      frames: [{ module: 0, offset: "0x500" }],
    });
    expect(trace!.threads[1]).toMatchObject({ crashing: false, main: true });
  });

  it("also scans the main thread when another thread crashed", () => {
    const trace = scan({
      stack: stack([0x100a10n]),
      mainThread: {
        threadId: 1,
        start: 0x9000n,
        sp: 0x9000n,
        ip: 0x300100n, // blocked in libc
        words: [0x100c30n, 0x55n],
      },
    });
    expect(trace!.threads).toEqual([
      {
        crashing: true,
        main: false,
        frames: [
          { module: 0, offset: "0x500" },
          { module: 0, offset: "0xa10" },
        ],
      },
      {
        crashing: false,
        main: true,
        frames: [
          { module: 1, offset: "0x100" },
          { module: 0, offset: "0xc30" },
        ],
      },
    ]);
    expect(trace!.modules.map((m) => m.name)).toEqual(["dyad", "libc.so.6"]);
  });

  it("names a module by its debug file when it has one", () => {
    const trace = scan({
      cvRecord: {
        kind: "pdb70",
        guid: Array.from({ length: 16 }, (_, i) => i),
        age: 1,
        name: "C:\\build\\electron.exe.pdb",
      },
      stack: stack([]),
    });
    expect(trace!.modules).toEqual([
      {
        name: "dyad",
        debugFile: "electron.exe.pdb",
        debugId: "030201000504070608090A0B0C0D0E0F1",
      },
    ]);
  });

  it("finds the arm64 caller in the link register", () => {
    const trace = scan(
      { spOffset: 256, stack: { ...stack([0x100a10n]), lr: 0x300040n } },
      "arm64",
    );
    expect(trace!.threads[0].frames).toEqual([
      { module: 0, offset: "0x500" },
      { module: 1, offset: "0x40" },
      { module: 0, offset: "0xa10" },
    ]);
  });

  it("cleans module names", () => {
    const trace = scan({
      modules: [
        {
          base: 0x100000n,
          size: 0x10000,
          name: "C:\\Users\\jo\\Dyad\\dyad.exe",
        },
        { base: 0x300000n, size: 0x1000, name: "/tmp/evil\nname.so" },
      ],
      stack: stack([0x300010n]),
    });
    expect(trace!.modules.map((m) => m.name)).toEqual([
      "dyad.exe",
      "evilname.so",
    ]);
  });
});

describe("cleanModuleName", () => {
  it("keeps the basename of ordinary libraries", () => {
    for (const name of [
      "libgdk_pixbuf-2.0.so.0",
      "api-ms-win-core-synch-l1-2-0.dll",
      "Electron Framework",
      "libstdc++.so.6",
    ]) {
      expect(cleanModuleName(`/some/dir/${name}`)).toBe(name);
    }
  });

  it("strips control characters and caps the length", () => {
    expect(cleanModuleName("a\u0000b\u202ec.dll")).toBe("abc.dll");
    expect(cleanModuleName("x".repeat(300) + ".dll")).toHaveLength(128);
    expect(cleanModuleName("/dir/")).toBe("unnamed");
  });
});
