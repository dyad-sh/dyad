import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { showError, showSuccess } from "@/lib/toast";

interface CreateFileParams {
  appId: number;
  filePath: string;
  content?: string;
}

interface DeleteFileParams {
  appId: number;
  filePath: string;
}

export const useFileManagement = (appId: number | null) => {
  const queryClient = useQueryClient();

  const createFile = useMutation({
    mutationFn: async (params: CreateFileParams) => {
      if (!appId) throw new Error("App ID is required");
      
      const ipcClient = IpcClient.getInstance();
      await ipcClient.createAppFile(appId, params.filePath, params.content);
    },
    onSuccess: () => {
      // Invalidate app data to refresh file list
      queryClient.invalidateQueries({ queryKey: ["app", appId] });
      showSuccess("File created successfully");
    },
    onError: (error) => {
      showError(error);
    },
  });

  const deleteFile = useMutation({
    mutationFn: async (params: DeleteFileParams) => {
      if (!appId) throw new Error("App ID is required");
      
      const ipcClient = IpcClient.getInstance();
      await ipcClient.deleteAppFile(appId, params.filePath);
    },
    onSuccess: () => {
      // Invalidate app data to refresh file list
      queryClient.invalidateQueries({ queryKey: ["app", appId] });
      showSuccess("File deleted successfully");
    },
    onError: (error) => {
      showError(error);
    },
  });

  return {
    createFile: createFile.mutateAsync,
    deleteFile: deleteFile.mutateAsync,
    isCreating: createFile.isPending,
    isDeleting: deleteFile.isPending,
  };
};
