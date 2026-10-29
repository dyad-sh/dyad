/** Stable IPC values; presentation copy belongs to the renderer's locale. */
export const TEST_RUN_WAIT_REASONS = [
  "process-cleanup",
  "capacity",
  "compatibility",
  "earlier-run",
  "starting",
] as const;

export type TestRunWaitReason = (typeof TEST_RUN_WAIT_REASONS)[number];
