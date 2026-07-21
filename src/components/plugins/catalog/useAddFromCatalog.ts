import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { McpCatalogEntry } from "@/ipc/types/mcp_catalog";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showSuccess } from "@/lib/toast";
import { usePluginConnect } from "../usePluginConnect";

export function useAddFromCatalog() {
  const queryClient = useQueryClient();
  const [addingSlug, setAddingSlug] = useState<string | null>(null);
  const { onServerCreated } = usePluginConnect();

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
    showSuccess(`Added "${created.name}"`);

    // Only required-OAuth servers connect automatically. Optional ones
    // work anonymously and offer Connect on their card. The connect
    // runs through the shared flow so it holds the connect slot (no
    // competing flow) and reuses the probed callback port; it is not
    // awaited so an abandoned browser step can't wedge the add.
    if (entry.oauth?.required) {
      void onServerCreated(created, { wantsOAuth: true });
    }
  };

  return { addFromCatalog, addingSlug } as const;
}
