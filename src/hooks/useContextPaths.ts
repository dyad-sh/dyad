import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import { GlobPath, ContextPathResults } from "@/lib/schemas";

export function useContextPaths() {
  const queryClient = useQueryClient();
  const appId = useAtomValue(selectedAppIdAtom);

  const {
    data: contextPathsData,
    isLoading,
    error,
  } = useQuery<ContextPathResults, Error>({
    queryKey: ["context-paths", appId],
    queryFn: async () => {
      if (!appId)
        return {
          contextPaths: [],
          smartContextAutoIncludes: [],
          excludePaths: [],
        };
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getChatContextResults({ appId });
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
      const ipcClient = IpcClient.getInstance();
      return ipcClient.setChatContext({
        appId,
        chatContext: {
          contextPaths,
          smartContextAutoIncludes: smartContextAutoIncludes || [],
          excludePaths: excludePaths || [],
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["context-paths", appId] });
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
