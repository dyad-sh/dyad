import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Whether an app's generated Supabase client still authenticates with the
 * project's legacy `anon` key, with a publishable key available to replace it.
 *
 * Detection failing is non-critical — the offer simply won't show — so no error
 * toast is surfaced. Cheap for the common case: the main process returns early
 * without a network call once an app is on a new-format key.
 */
export function useLegacySupabaseKey(appId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.supabase.legacyAppKey({ appId }),
    queryFn: async (): Promise<{ hasLegacyKey: boolean }> => {
      if (appId == null) {
        return { hasLegacyKey: false };
      }
      return ipc.supabase.detectLegacyAppKey({ appId });
    },
    enabled: enabled && appId != null,
  });
}

/**
 * Rewrite an app's generated Supabase client to use the publishable key. On
 * success, re-runs detection so the banner self-clears.
 */
export function useSwitchToPublishableKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { appId: number }) =>
      ipc.supabase.switchAppToPublishableKey(params),
    onSuccess: (_result, { appId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.supabase.legacyAppKey({ appId }),
      });
    },
  });
}
