import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { McpCatalogEntry } from "@/ipc/shared/remote_mcp_catalog";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showInfo, showSuccess } from "@/lib/toast";

export function useAddFromCatalog() {
  const queryClient = useQueryClient();
  const [addingSlug, setAddingSlug] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (entry: McpCatalogEntry) => {
      const created = await ipc.mcp.addFromCatalog({ slug: entry.slug });
      return { entry, created };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.mcp.catalog }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.mcp.toolsByServer.all,
        }),
      ]);
    },
    meta: { showErrorToast: true },
  });

  // OAuth connection runs after the plugin is already added. It is not
  // awaited by the add flow: the user may abandon the browser step, and
  // the connection status (and retry) lives on the configured plugin's
  // own card. Tools are re-fetched afterward because the first fetch
  // ran before authentication and cached an empty list.
  const connectOAuth = async (serverId: number, name: string) => {
    showInfo(`Connecting OAuth for "${name}"…`);
    const result = await ipc.mcp.startOAuth({ serverId });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.mcp.toolsByServer.all,
      }),
    ]);
    if (result.success) {
      showSuccess(`Connected "${name}"`);
    } else {
      showError(result.error ?? "OAuth connection failed");
    }
  };

  const addFromCatalog = async (entry: McpCatalogEntry) => {
    if (addingSlug) return;
    setAddingSlug(entry.slug);
    let created: Awaited<ReturnType<typeof ipc.mcp.addFromCatalog>> | null =
      null;
    try {
      // Only the row creation gates the "Adding…" state, so an
      // abandoned OAuth step can't wedge the catalog.
      ({ created } = await mutation.mutateAsync(entry));
    } catch {
      // The mutation already shows an error toast.
    } finally {
      setAddingSlug(null);
    }
    if (!created) return;
    if (entry.oauth === "none") {
      showSuccess(`Added "${created.name}"`);
    } else {
      void connectOAuth(created.id, created.name);
    }
  };

  return { addFromCatalog, addingSlug } as const;
}
