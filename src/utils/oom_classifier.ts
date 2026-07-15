import type { PerformanceSnapshot } from "./crash_telemetry_fields";
import type { MinidumpSummary } from "./minidump_summary";

// Whether a crash was memory exhaustion, decided from what the crash
// left behind. The verdict is the decision; the signals are the
// individual checks that matched, reported alongside it so the
// reasoning stays visible in telemetry.
//
// "native_oom": the dump itself declares the OOM, through the exception
// code, the failed allocation size, or V8's own crash keys.
//
// "suspected_oom": no dump exists, but the last heartbeat before the
// crash showed memory near exhaustion. Covers deaths that leave no
// dump, like the OS killing the process under memory pressure.
//
// "none": no sign of OOM. Memory pressure signals can still be present
// when a dump attributes the crash to something else; they stay in the
// signals list but do not change the verdict, since the dump already
// explained the crash.
export type OomVerdict = "native_oom" | "suspected_oom" | "none";

export type OomSignal =
  | "oom_exception_code"
  | "oom_allocation_size"
  | "oom_size_annotation"
  | "v8_heap_oom_annotation"
  | "v8_oom_annotation"
  | "peak_heap_near_limit"
  | "system_memory_near_limit";

export interface OomClassification {
  verdict: OomVerdict;
  signals: OomSignal[];
}

// Chromium's kOomExceptionCode, raised for Windows OOM crashes. Matched
// on the raw code so the verdict does not depend on the name table.
const CHROMIUM_OOM_EXCEPTION_CODE = 0xe0000008;

// A session peak this close to the V8 heap limit means allocations were
// at risk of failing. Conservative enough to survive sampling jitter in
// the 30 second heartbeat.
const HEAP_NEAR_LIMIT_PCT = 95;
// Same idea for whole-system memory at the last heartbeat.
const SYSTEM_MEMORY_NEAR_LIMIT_RATIO = 0.95;

export function classifyOom(input: {
  nativeCrash: MinidumpSummary | null;
  performance: PerformanceSnapshot | null;
  platform?: NodeJS.Platform;
}): OomClassification {
  const { nativeCrash, performance, platform = process.platform } = input;
  const signals: OomSignal[] = [];

  if (nativeCrash) {
    if (nativeCrash.exceptionCode === CHROMIUM_OOM_EXCEPTION_CODE) {
      signals.push("oom_exception_code");
    }
    if (nativeCrash.oomAllocationSizeBytes !== undefined) {
      signals.push("oom_allocation_size");
    }
    // Chromium's allocation size crash key, for dumps that declare the
    // OOM through annotations instead of exception parameters.
    if (nativeCrash.annotations?.["oom-size"]) {
      signals.push("oom_size_annotation");
    }
    // The specific heap OOM key subsumes the general v8-oom family, so
    // the two signals never appear together.
    if (nativeCrash.annotations?.["electron.v8-oom.is_heap_oom"] === "1") {
      signals.push("v8_heap_oom_annotation");
    } else if (hasV8OomAnnotation(nativeCrash.annotations)) {
      signals.push("v8_oom_annotation");
    }
  }
  const dumpSignals = signals.length;

  if (performance) {
    if ((performance.peakHeapPct ?? 0) >= HEAP_NEAR_LIMIT_PCT) {
      signals.push("peak_heap_near_limit");
    }
    // Skipped on macOS, where os.freemem() excludes reclaimable file
    // cache and a healthy system can look nearly full.
    const totalMB = performance.systemMemoryTotalMB ?? 0;
    const usedMB = performance.systemMemoryUsageMB ?? 0;
    if (
      platform !== "darwin" &&
      totalMB > 0 &&
      usedMB / totalMB >= SYSTEM_MEMORY_NEAR_LIMIT_RATIO
    ) {
      signals.push("system_memory_near_limit");
    }
  }

  if (dumpSignals > 0) {
    return { verdict: "native_oom", signals };
  }
  if (!nativeCrash && signals.length > 0) {
    return { verdict: "suspected_oom", signals };
  }
  return { verdict: "none", signals };
}

function hasV8OomAnnotation(
  annotations: Record<string, string> | undefined,
): boolean {
  return Object.keys(annotations ?? {}).some((key) =>
    key.startsWith("electron.v8-oom."),
  );
}
