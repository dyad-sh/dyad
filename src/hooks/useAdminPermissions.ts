import { IpcClient } from "@/ipc/ipc_client";
import { useQuery } from "@tanstack/react-query";

interface AdminPermissions {
  isSuperAdmin: boolean;
  canManageGlobalSettings: boolean;
}

/**
 * Returns the current user's admin permissions.
 * Reads from the local settings store; defaults to false.
 */
export function useAdminPermissions() {
  const { data: permissions = { isSuperAdmin: false, canManageGlobalSettings: false } } =
    useQuery<AdminPermissions>({
      queryKey: ["admin-permissions"],
      queryFn: async () => {
        try {
          const ipc = IpcClient.getInstance();
          const settings = await ipc.invoke("settings:get-all");
          return {
            isSuperAdmin: settings?.isAdmin === true,
            canManageGlobalSettings: settings?.isAdmin === true,
          };
        } catch {
          return { isSuperAdmin: false, canManageGlobalSettings: false };
        }
      },
      staleTime: 300_000,
    });

  return { permissions };
}
