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
      if (!appId) return { contextPaths: [], smartContextAutoIncludes: [] };
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getChatContextResults({ appId });
    },
    enabled: !!appId,
  });

  const updateContextPathsMutation = useMutation<
    unknown,
    Error,
    { contextPaths: GlobPath[]; smartContextAutoIncludes?: GlobPath[] }
  >({
    mutationFn: async ({ contextPaths, smartContextAutoIncludes }) => {
      if (!appId) throw new Error("No app selected");
      const ipcClient = IpcClient.getInstance();
      return ipcClient.setChatContext({
        appId,
        chatContext: {
          contextPaths,
          smartContextAutoIncludes: smartContextAutoIncludes || [],
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
    return updateContextPathsMutation.mutateAsync({
      contextPaths: paths,
      smartContextAutoIncludes: currentAutoIncludes.map(({ globPath }) => ({
        globPath,
      })),
    });
  };

  const updateSmartContextAutoIncludes = async (paths: GlobPath[]) => {
    const currentContextPaths = contextPathsData?.contextPaths || [];
    return updateContextPathsMutation.mutateAsync({
      contextPaths: currentContextPaths.map(({ globPath }) => ({ globPath })),
      smartContextAutoIncludes: paths,
    });
  };

  return {
    contextPaths: contextPathsData?.contextPaths || [],
    smartContextAutoIncludes: contextPathsData?.smartContextAutoIncludes || [],
    isLoading,
    error,
    updateContextPaths,
    updateSmartContextAutoIncludes,
  };
}
