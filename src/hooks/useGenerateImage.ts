import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc, type GenerateImageParams } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";

export function useGenerateImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: GenerateImageParams) => {
      return ipc.imageGeneration.generateImage(params);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
      showSuccess(`Image generated and saved to ${result.appName}`);
    },
    onError: (error) => {
      showError(error);
    },
  });
}
