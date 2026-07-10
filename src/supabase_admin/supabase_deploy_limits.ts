import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const MEBIBYTE = 1024 * 1024;

// These limits apply to the source payload sent to the Supabase Management
// API. Multipart encoding may keep another copy of the payload in memory, so
// keep the source budget comfortably below the main-process heap ceiling.
export const MAX_SUPABASE_DEPLOY_FILE_BYTES = 16 * MEBIBYTE;
export const MAX_SUPABASE_DEPLOY_FILES = 512;
export const MAX_SUPABASE_DEPLOY_TOTAL_BYTES = 32 * MEBIBYTE;

export const SUPABASE_DEPLOY_ACTIVE_PAYLOAD_BYTE_BUDGET = 48 * MEBIBYTE;
export const MAX_SUPABASE_DEPLOY_PENDING_TASKS_PER_PROJECT = 128;

export const SUPABASE_SHARED_FILES_CACHE_MAX_BYTES = 32 * MEBIBYTE;
export const SUPABASE_SHARED_FILES_CACHE_MAX_ENTRIES = 8;
export const SUPABASE_SHARED_FILES_CACHE_TTL_MS = 5 * 60 * 1000;

export interface SupabaseDeployPayloadBudget {
  readonly context: string;
  fileCount: number;
  totalBytes: number;
}

export function createSupabaseDeployPayloadBudget(
  context: string,
): SupabaseDeployPayloadBudget {
  return { context, fileCount: 0, totalBytes: 0 };
}

export function addFileToSupabaseDeployPayloadBudget(
  budget: SupabaseDeployPayloadBudget,
  relativePath: string,
  size: number,
): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new DyadError(
      `Cannot deploy ${budget.context}: ${relativePath} has an invalid file size`,
      DyadErrorKind.Validation,
    );
  }

  if (size > MAX_SUPABASE_DEPLOY_FILE_BYTES) {
    throw new DyadError(
      `Cannot deploy ${budget.context}: ${relativePath} is ${formatBytes(size)}, exceeding the ${formatBytes(MAX_SUPABASE_DEPLOY_FILE_BYTES)} per-file limit`,
      DyadErrorKind.Validation,
    );
  }

  const nextFileCount = budget.fileCount + 1;
  if (nextFileCount > MAX_SUPABASE_DEPLOY_FILES) {
    throw new DyadError(
      `Cannot deploy ${budget.context}: the payload contains more than ${MAX_SUPABASE_DEPLOY_FILES} files`,
      DyadErrorKind.Validation,
    );
  }

  const nextTotalBytes = budget.totalBytes + size;
  if (nextTotalBytes > MAX_SUPABASE_DEPLOY_TOTAL_BYTES) {
    throw new DyadError(
      `Cannot deploy ${budget.context}: the payload is larger than the ${formatBytes(MAX_SUPABASE_DEPLOY_TOTAL_BYTES)} aggregate limit`,
      DyadErrorKind.Validation,
    );
  }

  budget.fileCount = nextFileCount;
  budget.totalBytes = nextTotalBytes;
}

function formatBytes(bytes: number): string {
  if (bytes < MEBIBYTE) {
    return `${Math.ceil(bytes / 1024)} KiB`;
  }
  return `${(bytes / MEBIBYTE).toFixed(1)} MiB`;
}
