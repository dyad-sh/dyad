import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useAppTheme(appId: number | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.appTheme.byApp({ appId }),
    queryFn: async (): Promise<string | null> => {
      return ipc.template.getAppTheme({ appId: appId! });
    },
    enabled: !!appId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.appTheme.byApp({ appId }),
    });
  };

  return {
    themeId: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    invalidate,
  };
}
