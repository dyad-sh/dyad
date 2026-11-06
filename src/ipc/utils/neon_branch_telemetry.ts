import { sendTelemetryEvent } from "./telemetry";

/** Which branch failed, so leaks can be told apart in telemetry. */
export type NeonBranchKind =
  | "development"
  | "preview"
  | "backup"
  | "test"
  | "migration_source"
  | "old_tree"
  | "leftover";

const ERROR_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

interface NeonApiErrorLike {
  name?: unknown;
  code?: unknown;
  response?: { status?: unknown; data?: { code?: unknown } };
}

function codeOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && ERROR_CODE.test(value)
    ? value
    : undefined;
}

/**
 * Send `neon:branch-create-failed` or `neon:branch-delete-failed`. Only the
 * branch kind, the HTTP status and Neon's error code are sent, never branch
 * names, IDs or messages. A delete that 404s isn't reported: the branch is
 * already gone, so nothing leaked.
 */
export function reportNeonBranchFailure(
  action: "create" | "delete",
  kind: NeonBranchKind,
  error: unknown,
): void {
  const e = (error ?? {}) as NeonApiErrorLike;
  if (e.name === "AbortError" || e.code === "ERR_CANCELED") return;
  const rawStatus = e.response?.status;
  const status = typeof rawStatus === "number" ? rawStatus : undefined;
  if (action === "delete" && status === 404) return;
  sendTelemetryEvent(`neon:branch-${action}-failed`, {
    kind,
    failure:
      status !== undefined
        ? "http"
        : codeOrUndefined(e.code)
          ? "network"
          : "unknown",
    status,
    errorCode:
      status !== undefined
        ? codeOrUndefined(e.response?.data?.code)
        : codeOrUndefined(e.code),
  });
}

/** Run a branch create, reporting a failure before rethrowing it. */
export async function reportingNeonBranchCreate<T>(
  kind: NeonBranchKind,
  create: () => Promise<T>,
): Promise<T> {
  try {
    return await create();
  } catch (error) {
    reportNeonBranchFailure("create", kind, error);
    throw error;
  }
}
