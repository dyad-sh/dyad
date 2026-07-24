import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { McpCatalogEntry } from "@/ipc/types/mcp_catalog";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showSuccess } from "@/lib/toast";
import { usePluginConnect } from "../usePluginConnect";

export function useAddFromCatalog() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [addingSlug, setAddingSlug] = useState<string | null>(null);
  // A stdio entry awaiting the user's run-locally consent. Null when no
  // consent is pending.
  const [pendingStdioEntry, setPendingStdioEntry] =
    useState<McpCatalogEntry | null>(null);
  const { onServerCreated } = usePluginConnect();

  const mutation = useMutation({
    mutationFn: async (entry: McpCatalogEntry) => {
      // Send the reviewed command so the handler can abort if the catalog
      // changed since the consent prompt.
      const created = await ipc.mcp.addFromCatalog({
        slug: entry.slug,
        expectedStdioConfig:
          entry.transport === "stdio"
            ? {
                command: entry.command,
                args: entry.args,
                env: entry.env ?? null,
              }
            : undefined,
      });
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

  const performAdd = async (entry: McpCatalogEntry) => {
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

    // A server that declares inputs was added disabled and needs the user
    // to fill them in, so send them to its setup page instead of
    // connecting.
    if ((entry.inputs?.length ?? 0) > 0) {
      navigate({
        to: "/plugins/$serverId",
        params: { serverId: String(created.id) },
      });
      return;
    }

    // Only required-OAuth servers connect automatically. Optional ones
    // work anonymously and offer Connect on their card. The connect
    // runs through the shared flow so it holds the connect slot (no
    // competing flow) and reuses the probed callback port; it is not
    // awaited so an abandoned browser step can't wedge the add.
    if (entry.transport === "http" && entry.oauth?.required) {
      void onServerCreated(created, { wantsOAuth: true });
    }
  };

  const addFromCatalog = async (entry: McpCatalogEntry) => {
    // Adding an stdio entry enables it, which runs its npm package
    // locally, so confirm before adding. http entries only open a
    // network connection and add directly.
    if (entry.transport === "stdio") {
      setPendingStdioEntry(entry);
      return;
    }
    await performAdd(entry);
  };

  const confirmPendingStdio = async () => {
    const entry = pendingStdioEntry;
    setPendingStdioEntry(null);
    if (entry) await performAdd(entry);
  };

  const cancelPendingStdio = () => setPendingStdioEntry(null);

  return {
    addFromCatalog,
    addingSlug,
    pendingStdioEntry,
    confirmPendingStdio,
    cancelPendingStdio,
  } as const;
}
