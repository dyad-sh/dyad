import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc, type AddSupabaseSelfHostedInstanceParams } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useSupabaseSelfHostedInstances({
  enabled,
}: {
  enabled: boolean;
}) {
  return useQuery<
    Awaited<ReturnType<typeof ipc.supabase.listSelfHostedInstances>>,
    Error
  >({
    queryKey: queryKeys.supabase.selfHostedInstances,
    queryFn: () => ipc.supabase.listSelfHostedInstances(),
    enabled,
    meta: { showErrorToast: true },
  });
}

export function useAddSupabaseSelfHostedInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: AddSupabaseSelfHostedInstanceParams) =>
      ipc.supabase.addSelfHostedInstance(params),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.supabase.selfHostedInstances,
      }),
    // The form shows the failure next to the fields it is about.
    meta: { showErrorToast: false },
  });
}

export function useRemoveSupabaseSelfHostedInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.supabase.removeSelfHostedInstance({ id }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.supabase.selfHostedInstances,
      }),
    meta: { showErrorToast: true },
  });
}
