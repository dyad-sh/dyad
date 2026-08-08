import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { ipc } from "@/ipc/types";
import { GlobPath, ContextPathResults } from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";

export function useContextPaths() {
  const queryClient = useQueryClient();
  const appId = useAtomValue(selectedAppIdAtom);

  const {
    data: contextPathsData,
    isLoading,
    error,
  } = useQuery<ContextPathResults, Error>({
    queryKey: queryKeys.contextPaths.byApp({ appId }),
    queryFn: async () => {
      if (!appId)
        return {
          contextPaths: [],
          smartContextAutoIncludes: [],
          excludePaths: [],
        };
      return ipc.context.getContextPaths({ appId });
    },
    enabled: !!appId,
  });

  const updateContextPathsMutation = useMutation<
    unknown,
    Error,
    {
      contextPaths: GlobPath[];
      smartContextAutoIncludes?: GlobPath[];
      excludePaths?: GlobPath[];
    }
  >({
    mutationFn: async ({
      contextPaths,
      smartContextAutoIncludes,
      excludePaths,
    }) => {
      if (!appId) throw new Error("No app selected");
      return ipc.context.setContextPaths({
        appId,
        chatContext: {
          contextPaths,
          smartContextAutoIncludes: smartContextAutoIncludes || [],
          excludePaths: excludePaths || [],
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contextPaths.byApp({ appId }),
      });
    },
  });

  const updateContextPaths = async (paths: GlobPath[]) => {
    const currentAutoIncludes =
      contextPathsData?.smartContextAutoIncludes || [];
    const currentExcludePaths = contextPathsData?.excludePaths || [];
    return updateContextPathsMutation.mutateAsync({
      contextPaths: paths,
      smartContextAutoIncludes: currentAutoIncludes.map(
        ({ globPath }: { globPath: string }) => ({
          globPath,
        }),
      ),
      excludePaths: currentExcludePaths.map(
        ({ globPath }: { globPath: string }) => ({
          globPath,
        }),
      ),
    });
  };

  const updateSmartContextAutoIncludes = async (paths: GlobPath[]) => {
    const currentContextPaths = contextPathsData?.contextPaths || [];
    const currentExcludePaths = contextPathsData?.excludePaths || [];
    return updateContextPathsMutation.mutateAsync({
      contextPaths: currentContextPaths.map(
        ({ globPath }: { globPath: string }) => ({ globPath }),
      ),
      smartContextAutoIncludes: paths,
      excludePaths: currentExcludePaths.map(
        ({ globPath }: { globPath: string }) => ({
          globPath,
        }),
      ),
    });
  };

  const updateExcludePaths = async (paths: GlobPath[]) => {
    const currentContextPaths = contextPathsData?.contextPaths || [];
    const currentAutoIncludes =
      contextPathsData?.smartContextAutoIncludes || [];
    return updateContextPathsMutation.mutateAsync({
      contextPaths: currentContextPaths.map(
        ({ globPath }: { globPath: string }) => ({ globPath }),
      ),
      smartContextAutoIncludes: currentAutoIncludes.map(
        ({ globPath }: { globPath: string }) => ({
          globPath,
        }),
      ),
      excludePaths: paths,
    });
  };

  return {
    contextPaths: contextPathsData?.contextPaths || [],
    smartContextAutoIncludes: contextPathsData?.smartContextAutoIncludes || [],
    excludePaths: contextPathsData?.excludePaths || [],
    isLoading,
    error,
    updateContextPaths,
    updateSmartContextAutoIncludes,
    updateExcludePaths,
  };
}
