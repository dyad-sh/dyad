import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Cloud,
  Database,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { chatAgentHistoryAtom } from "@/atoms/chatAgentAtoms";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ipc } from "@/ipc/types";
import { isIpcRendererAvailable } from "@/ipc/contracts/core";
import { queryKeys } from "@/lib/queryKeys";
import { SECTION_IDS, SETTING_IDS } from "@/lib/settingsSearchIndex";
import { showError, showSuccess } from "@/lib/toast";
import { useSettings } from "@/hooks/useSettings";
import { useSettingsDraftContext } from "@/contexts/SettingsDraftContext";
import { SettingsTabSaveBar } from "./SettingsTabSaveBar";
import { VercelBlobConnectionSettings } from "./VercelBlobConnectionSettings";

const DEFAULTS = {
  destination: "local" as const,
  autoSync: true,
  syncConversations: true,
  syncGeneratedMedia: true,
  syncSystemNotes: true,
};

export function StorageSettings() {
  const { settings, updateSettings } = useSettings();
  // Null outside the Settings page, where writes already persist directly.
  const draft = useSettingsDraftContext();
  const history = useAtomValue(chatAgentHistoryAtom);
  const queryClient = useQueryClient();
  const storage = { ...DEFAULTS, ...settings?.storage };
  const hasIpc = isIpcRendererAvailable();

  const statusQuery = useQuery({
    queryKey: queryKeys.storage.status(storage.localVaultPath),
    queryFn: () =>
      ipc.storage.status({ localVaultPath: storage.localVaultPath }),
    enabled: hasIpc,
  });

  const setStorage = (patch: Partial<typeof storage>) =>
    updateSettings({ storage: { ...storage, ...patch } });

  /**
   * Choosing a vault is an action, not a form edit: persist it right away
   * rather than leaving it in the Settings draft, where it would be lost
   * unless the user also pressed Save.
   */
  const commitStorageNow = async (patch: Partial<typeof storage>) => {
    await setStorage(patch);
    await draft?.saveTab("storage");
  };

  const createMutation = useMutation({
    mutationFn: () => ipc.storage.createVault(),
    onSuccess: async ({ path }) => {
      if (!path) return;
      await commitStorageNow({ localVaultPath: path });
      await queryClient.invalidateQueries({ queryKey: queryKeys.storage.all });
      showSuccess("Vault created");
    },
    onError: (error) =>
      showError(
        error instanceof Error ? error.message : "Could not create vault",
      ),
  });

  const chooseMutation = useMutation({
    mutationFn: () => ipc.storage.chooseVault(),
    onSuccess: async ({ path }) => {
      if (!path) return;
      await ipc.storage.initializeVault({ path });
      await commitStorageNow({ localVaultPath: path });
      await queryClient.invalidateQueries({ queryKey: queryKeys.storage.all });
      showSuccess("Local vault ready");
    },
    onError: (error) =>
      showError(
        error instanceof Error ? error.message : "Could not create vault",
      ),
  });

  const openMutation = useMutation({
    mutationFn: () =>
      ipc.storage.openVault({ path: storage.localVaultPath ?? "" }),
    onError: (error) =>
      showError(
        error instanceof Error ? error.message : "Could not open vault",
      ),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      return ipc.storage.sync({
        preferences: {
          destination: storage.destination,
          localVaultPath: storage.localVaultPath,
          autoSync: storage.autoSync,
          syncConversations: storage.syncConversations,
          syncGeneratedMedia: storage.syncGeneratedMedia,
          syncSystemNotes: storage.syncSystemNotes,
        },
        chatAgentConversations: history.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          updatedAt: conversation.updatedAt,
          messages: conversation.messages.map(({ role, content }) => ({
            role,
            content,
          })),
        })),
      });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.storage.all });
      showSuccess(
        `Synced ${result.conversations} conversations, ${result.media} media files and ${result.notes} notes`,
      );
    },
    onError: (error) =>
      showError(error instanceof Error ? error.message : "Storage sync failed"),
  });

  const ready =
    storage.destination === "local"
      ? statusQuery.data?.localVaultReady
      : statusQuery.data?.cloudConnected;
  const lastSync = useMemo(() => {
    const value = statusQuery.data?.lastSyncedAt ?? storage.lastSyncedAt;
    return value ? new Date(value).toLocaleString() : "Never";
  }, [statusQuery.data?.lastSyncedAt, storage.lastSyncedAt]);

  return (
    <div id={SECTION_IDS.storage} className="space-y-5 scroll-mt-24">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <Database className="size-5 text-cyan-300" />
          <h2 className="font-jarvis-ui text-lg font-semibold text-cyan-50">
            Storage
          </h2>
        </div>
        <p className="text-sm text-cyan-100/50">
          Choose one home for conversations, generated media and durable system
          notes. Nothing is uploaded unless Cloud is selected.
        </p>
      </div>

      <div
        id={SETTING_IDS.storageDestination}
        className="grid gap-3 md:grid-cols-2"
      >
        {[
          {
            id: "local" as const,
            title: "Local Vault",
            description: "Private Markdown and media files you fully control.",
            icon: HardDrive,
          },
          {
            id: "cloud" as const,
            title: "Vercel Blob",
            description: "Cloud storage available across your devices.",
            icon: Cloud,
          },
        ].map((option) => {
          const selected = storage.destination === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => void setStorage({ destination: option.id })}
              className={`rounded-xl border p-4 text-left transition ${
                selected
                  ? "border-cyan-300/55 bg-cyan-400/10 shadow-[0_0_20px_rgba(34,211,238,0.10)]"
                  : "border-cyan-400/15 bg-slate-950/25 hover:border-cyan-300/30"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="grid size-10 place-items-center rounded-lg bg-cyan-400/10 text-cyan-300">
                  <option.icon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-medium text-cyan-50">
                    {option.title}
                    {selected && (
                      <CheckCircle2 className="size-4 text-cyan-300" />
                    )}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-cyan-100/45">
                    {option.description}
                  </span>
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {storage.destination === "local" ? (
        <div
          id={SETTING_IDS.localVault}
          className="rounded-xl border border-cyan-400/15 bg-slate-950/35 p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-cyan-50">
                Obsidian-compatible vault
                {statusQuery.data?.localVaultReady && (
                  <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-300">
                    Ready
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-cyan-100/45">
                Standard .md files with folders for Conversations, Notes and
                Media. Open it in Obsidian, Finder or any text editor.
              </p>
              <p className="mt-2 break-all font-mono text-xs text-cyan-200/70">
                {storage.localVaultPath || "No folder selected"}
              </p>
            </div>
            <div className="flex gap-2">
              {storage.localVaultPath && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openMutation.mutate()}
                  disabled={openMutation.isPending}
                >
                  <FolderOpen className="mr-2 size-4" />
                  Open
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => chooseMutation.mutate()}
                disabled={chooseMutation.isPending || createMutation.isPending}
              >
                {chooseMutation.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <FolderOpen className="mr-2 size-4" />
                )}
                Use existing folder
              </Button>
              <Button
                size="sm"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || chooseMutation.isPending}
                data-testid="storage-create-vault"
              >
                {createMutation.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <FolderPlus className="mr-2 size-4" />
                )}
                Create vault
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div id={SETTING_IDS.vercelBlob}>
          <VercelBlobConnectionSettings />
        </div>
      )}

      <div className="rounded-xl border border-cyan-400/15 bg-slate-950/35 p-4">
        <h3 className="text-sm font-medium text-cyan-50">What to store</h3>
        <div className="mt-3 divide-y divide-cyan-400/10">
          {[
            {
              key: "autoSync" as const,
              title: "Auto-populate vault",
              description:
                "Keep Markdown, indexes and generated media updated automatically.",
            },
            {
              key: "syncConversations" as const,
              title: "Conversations",
              description:
                "Chat Agent and app conversations as readable Markdown.",
            },
            {
              key: "syncGeneratedMedia" as const,
              title: "Generated media",
              description: "Generated images, videos and related files.",
            },
            {
              key: "syncSystemNotes" as const,
              title: "System notes",
              description:
                "Durable app context and notes in an editable Notes folder.",
            },
          ].map((item) => (
            <label
              key={item.key}
              className="flex cursor-pointer items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <span>
                <span className="block text-sm text-cyan-50/90">
                  {item.title}
                </span>
                <span className="block text-xs text-cyan-100/40">
                  {item.description}
                </span>
              </span>
              <Switch
                checked={storage[item.key]}
                onCheckedChange={(checked) =>
                  void setStorage({ [item.key]: checked })
                }
              />
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-400/15 bg-cyan-400/5 p-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="size-5 text-cyan-300" />
          <div>
            <p className="text-sm text-cyan-50">
              {ready ? "Destination ready" : "Finish setup to sync"}
            </p>
            <p className="text-xs text-cyan-100/40">
              {storage.autoSync ? "Auto sync on" : "Manual sync"} · Last sync:{" "}
              {lastSync}
            </p>
          </div>
        </div>
        <Button
          onClick={() => syncMutation.mutate()}
          disabled={!ready || syncMutation.isPending}
        >
          {syncMutation.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          Sync now
        </Button>
      </div>

      <SettingsTabSaveBar tabId="storage" />
    </div>
  );
}
