import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Whether an app's generated Supabase client still authenticates with the
 * project's legacy `anon` key, with a publishable key available to replace it.
 *
 * `projectId` is part of the cache key, not just an input: the verdict belongs
 * to one app/project pairing, so repointing a mounted app at another project
 * must not keep showing the previous project's answer.
 *
 * Detection failing is non-critical — the offer simply won't show — so no error
 * toast is surfaced. Cheap for the common case: the main process returns early
 * without a network call once an app is on a new-format key.
 */
export function useLegacySupabaseKey({
  appId,
  projectId,
  enabled,
}: {
  appId: number | null;
  projectId: string | null;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: queryKeys.supabase.legacyAppKey({ appId, projectId }),
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
      // App-scoped prefix: clears the verdict for every project this app has
      // been pointed at, since only the app's own file was rewritten.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.supabase.legacyAppKeyForApp({ appId }),
      });
    },
  });
}
