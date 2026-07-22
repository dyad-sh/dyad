import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import type { LegacyTestFile } from "@/ipc/types/tests";

export type { LegacyTestFile };

/**
 * Detect Playwright specs still living in the legacy `tests/` directory for an
 * app. `enabled` gates the scan (e.g. run it only when the Tests panel is
 * engaged and the migration offer hasn't been dismissed). Detection failing is
 * non-critical — the offer simply won't show — so no error toast is surfaced.
 */
export function useLegacyTests(appId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.tests.legacy({ appId }),
    queryFn: async (): Promise<{ files: LegacyTestFile[] }> => {
      if (appId == null) {
        return { files: [] };
      }
      return ipc.tests.detectLegacyTests({ appId });
    },
    enabled: enabled && appId != null,
  });
}

/**
 * Move selected legacy specs from `tests/` into `e2e-tests/`. On success,
 * refreshes the panel's spec list (migrated specs appear) and re-runs legacy
 * detection (so the banner self-clears once the files are gone from `tests/`).
 */
export function useMigrateLegacyTests() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { appId: number; files: string[] }) =>
      ipc.tests.migrateLegacyTests(params),
    onSuccess: (_result, { appId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tests.list({ appId }),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tests.legacy({ appId }),
      });
    },
  });
}
