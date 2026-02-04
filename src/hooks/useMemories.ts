import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import type { MemoryDto } from "@/ipc/types";

export function useMemories() {
  const queryClient = useQueryClient();
  const appId = useAtomValue(selectedAppIdAtom);

  const {
    data: memories,
    isLoading,
    error,
  } = useQuery<MemoryDto[], Error>({
    queryKey: queryKeys.memories.byApp({ appId }),
    queryFn: async () => {
      if (!appId) return [];
      return ipc.memory.listByApp(appId);
    },
    enabled: !!appId,
  });

  const createMemory = useMutation({
    mutationFn: async (content: string) => {
      if (!appId) throw new Error("No app selected");
      return ipc.memory.create({ appId, content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.memories.byApp({ appId }),
      });
    },
  });

  const updateMemory = useMutation({
    mutationFn: async ({ id, content }: { id: number; content: string }) => {
      return ipc.memory.update({ id, content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.memories.byApp({ appId }),
      });
    },
  });

  const deleteMemory = useMutation({
    mutationFn: async (id: number) => {
      return ipc.memory.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.memories.byApp({ appId }),
      });
    },
  });

  return {
    memories: memories ?? [],
    isLoading,
    error,
    createMemory,
    updateMemory,
    deleteMemory,
  };
}
