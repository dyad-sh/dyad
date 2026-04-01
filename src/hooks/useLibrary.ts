import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { toast } from "sonner";

export interface LibraryItem {
  id: number;
  name: string;
  description: string | null;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  storagePath: string;
  storageTier: string;
  cid: string | null;
  arweaveId: string | null;
  pinned: boolean;
  tags: string[] | null;
  category: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryFilters {
  storageTier?: string;
  mimeType?: string;
  search?: string;
  category?: string;
}

export function useLibraryItems(filters?: LibraryFilters) {
  return useQuery({
    queryKey: ["library-items", filters],
    queryFn: async (): Promise<LibraryItem[]> => {
      const ipc = IpcClient.getInstance();
      return ipc.libraryList(filters);
    },
    meta: { showErrorToast: true },
  });
}

export function useLibraryItem(id: number | null) {
  return useQuery({
    queryKey: ["library-item", id],
    queryFn: async (): Promise<LibraryItem> => {
      const ipc = IpcClient.getInstance();
      return ipc.libraryGet(id!);
    },
    enabled: !!id,
  });
}

export function useLibraryItemContent(id: number | null) {
  return useQuery({
    queryKey: ["library-item-content", id],
    queryFn: async (): Promise<string> => {
      const ipc = IpcClient.getInstance();
      return ipc.libraryGetContent(id!);
    },
    enabled: !!id,
  });
}

export function useUploadToLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const ipc = IpcClient.getInstance();
      return ipc.libraryUploadDialog();
    },
    onSuccess: (items) => {
      queryClient.invalidateQueries({ queryKey: ["library-items"] });
      if (items.length > 0) {
        toast.success(`Added ${items.length} file${items.length > 1 ? "s" : ""} to library`);
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useImportLibraryBuffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { name: string; base64: string; mimeType?: string }) => {
      const ipc = IpcClient.getInstance();
      return ipc.libraryImportBuffer(params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-items"] });
      toast.success("File added to library");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useDeleteLibraryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const ipc = IpcClient.getInstance();
      await ipc.libraryDelete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-items"] });
      toast.success("File removed from library");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useUpdateLibraryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: number; name?: string; description?: string; tags?: string[]; category?: string }) => {
      const ipc = IpcClient.getInstance();
      return ipc.libraryUpdate(params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-items"] });
      toast.success("File updated");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useStoreToIpfs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const ipc = IpcClient.getInstance();
      return ipc.libraryStoreToIpfs(id);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["library-items"] });
      toast.success(`Stored on IPFS — CID: ${result.cid.slice(0, 12)}…`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function usePinToRemote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const ipc = IpcClient.getInstance();
      return ipc.libraryPinToRemote(id);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["library-items"] });
      toast.success(`Pinned via ${result.provider || "remote"} — CID: ${result.cid.slice(0, 12)}…`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useStoreToArweave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const ipc = IpcClient.getInstance();
      return ipc.libraryStoreToArweave(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-items"] });
      toast.success("Stored on Arweave");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useStoreToFilecoin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const ipc = IpcClient.getInstance();
      return ipc.libraryStoreToFilecoin(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-items"] });
      toast.success("Stored on Filecoin");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
