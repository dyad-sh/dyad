import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { toast } from "sonner";

export function useDataVaultExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      outputPath: string;
      filter?: {
        status?: string;
        modality?: string;
        tags?: string[];
        collections?: string[];
      };
    }) => IpcClient.getInstance().exportDataVault(args),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["data-vault"] });
      toast.success(`Exported ${result.count} vault entries to ${result.path.split(/[/\\]/).pop()}`);
    },
    onError: (err: Error) => toast.error(`Export failed: ${err.message}`),
  });
}
