import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteConfirmationDialog } from "@/components/DeleteConfirmationDialog";
import { useMcp } from "@/hooks/useMcp";
import type { McpAppConfig, McpServer } from "@/ipc/types";
import {
  isRequiredInput,
  userSuppliedInputs,
  type McpCatalogEntry,
} from "@/ipc/types/mcp_catalog";
import {
  PluginConnectionPanel,
  PluginOAuthBadge,
  PluginOAuthButtons,
} from "./PluginConnectionPanel";
import {
  PluginAppPicker,
  formatAppNames,
  type PickableApp,
} from "./PluginAppPicker";
import { connectionSetupState } from "./pluginSetup";

/**
 * A suggested name for a new configuration that no existing one uses.
 * Numbering starts at 2, since the default is the first configuration.
 */
export function nextConfigurationName(
  appConfigs: readonly { name: string }[],
): string {
  const taken = new Set(appConfigs.map((config) => config.name));
  let n = 2;
  while (taken.has(`Configuration ${n}`)) n++;
  return `Configuration ${n}`;
}

/** What an app falls back to once it stops using an app-specific config. */
export function fallbackDescription(
  server: McpServer,
  appId: number,
): "default" | "none" {
  const servedByDefault =
    server.defaultScope === "all" ||
    (server.defaultScope === "selected" &&
      server.defaultAppIds.includes(appId));
  return servedByDefault ? "default" : "none";
}

function fallbackSentence(
  server: McpServer,
  appIds: readonly number[],
  apps: readonly PickableApp[],
): string[] {
  const toDefault = appIds.filter(
    (appId) => fallbackDescription(server, appId) === "default",
  );
  const toNone = appIds.filter(
    (appId) => fallbackDescription(server, appId) === "none",
  );
  const sentences: string[] = [];
  if (toDefault.length > 0) {
    sentences.push(
      `${formatAppNames(toDefault, apps)} will use the default configuration.`,
    );
  }
  if (toNone.length > 0) {
    sentences.push(
      `${formatAppNames(toNone, apps)} won't have ${server.name}${
        server.defaultScope === "none"
          ? " (the default is set to No apps)."
          : "."
      }`,
    );
  }
  return sentences;
}

/** Creates a configuration, or edits an existing one's name and apps. */
function AppConfigDialog({
  open,
  onOpenChange,
  server,
  appConfigs,
  apps,
  editing,
  onSaved,
  requiresSetup = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: McpServer;
  appConfigs: McpAppConfig[];
  apps: PickableApp[];
  /** The configuration being edited; creates a new one when absent. */
  editing?: McpAppConfig;
  onSaved: (config: McpAppConfig) => void;
  /** A new configuration has required setup fields to fill in. */
  requiresSetup?: boolean;
}) {
  const {
    createAppConfig,
    setAppConfigApps,
    updateConnection,
    isSavingAppScope,
  } = useMcp();
  const [name, setName] = useState(
    editing?.name ?? nextConfigurationName(appConfigs),
  );
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(editing?.appIds ?? []),
  );

  const otherConfigByApp = new Map<number, McpAppConfig>();
  for (const config of appConfigs) {
    if (config.id === editing?.id) continue;
    for (const appId of config.appIds) otherConfigByApp.set(appId, config);
  }
  const moving = [...selected].filter((appId) => otherConfigByApp.has(appId));
  const removed = (editing?.appIds ?? []).filter(
    (appId) => !selected.has(appId),
  );
  const trimmedName = name.trim();

  const save = async () => {
    const appIds = [...selected];
    let saved: McpAppConfig;
    if (editing) {
      if (trimmedName !== editing.name) {
        await updateConnection(editing.connection, { name: trimmedName });
      }
      saved = await setAppConfigApps({
        serverId: editing.serverId,
        appConfigId: editing.id,
        appIds,
      });
    } else {
      saved = await createAppConfig({
        serverId: server.id,
        name: trimmedName,
        appIds,
      });
    }
    onSaved(saved);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      // The close button, Escape and an outside click all wait for a save
      // in flight, like Cancel.
      onOpenChange={(next) => {
        if (!next && isSavingAppScope) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? `Edit ${editing.name}`
              : `New configuration for ${server.name}`}
          </DialogTitle>
          <DialogDescription>
            The apps you choose use this configuration instead of the default.
            An app can use only one configuration of a plugin.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="plugin-app-config-name">Name</Label>
            <Input
              id="plugin-app-config-name"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Used by</Label>
            <PluginAppPicker
              apps={apps}
              selected={selected}
              onChange={setSelected}
              disabled={isSavingAppScope}
              noteFor={(appId) => {
                const other = otherConfigByApp.get(appId);
                return other ? `currently: ${other.name}` : undefined;
              }}
            />
          </div>
          {moving.length > 0 && (
            <p
              className="text-xs text-amber-700 dark:text-amber-400"
              data-testid="plugin-app-config-move-warning"
            >
              {moving
                .map(
                  (appId) =>
                    `${formatAppNames([appId], apps)} will move from ${
                      otherConfigByApp.get(appId)!.name
                    }.`,
                )
                .join(" ")}
            </p>
          )}
          {removed.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {fallbackSentence(server, removed, apps).join(" ")}
            </p>
          )}
          {!editing && (
            <p className="text-xs text-muted-foreground">
              You'll enter this configuration's settings and credentials after
              creating it. Nothing is copied from the default configuration's
              credentials.
              {requiresSetup &&
                ` The apps you choose won't have ${server.name} until you finish setting it up.`}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSavingAppScope}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void save().catch(() => {})}
            disabled={!trimmedName || isSavingAppScope}
          >
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppConfigCard({
  config,
  server,
  appConfigs,
  apps,
  catalogEntry,
  catalogIsLoading,
  expanded,
  onToggleExpanded,
}: {
  config: McpAppConfig;
  server: McpServer;
  appConfigs: McpAppConfig[];
  apps: PickableApp[];
  catalogEntry: McpCatalogEntry | undefined;
  catalogIsLoading: boolean;
  expanded: boolean;
  /** Absent while the card is held open, so it has nothing to toggle. */
  onToggleExpanded?: () => void;
}) {
  const { deleteAppConfig } = useMcp();
  const [editOpen, setEditOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { needsSetup, setupIncomplete } = connectionSetupState(
    config,
    catalogEntry,
    catalogIsLoading,
  );
  const usedBy = formatAppNames(config.appIds, apps);
  // A sign-in for this configuration may be meant for a different account
  // than the default's; the browser picks whichever account it's on.
  const showAccountHint =
    config.oauthEnabled && !config.oauthConnected && !setupIncomplete;

  return (
    <div className="rounded-lg border p-4" data-testid="plugin-app-config">
      <div className="flex items-center justify-between gap-3">
        <CardHeaderToggle expanded={expanded} onToggle={onToggleExpanded}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium">
              <span className="truncate">{config.name}</span>
              {needsSetup && (
                <span className="text-xs font-medium px-2 py-1 rounded-full shrink-0 text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-500/50">
                  Needs setup
                </span>
              )}
              <PluginOAuthBadge connection={config} />
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {usedBy ? `Used by: ${usedBy}` : "Not used by any app"}
            </div>
          </div>
        </CardHeaderToggle>
        <div className="flex shrink-0 items-center gap-2">
          <PluginOAuthButtons
            connection={config}
            setupIncomplete={setupIncomplete}
          />
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <DeleteConfirmationDialog
            itemName={config.name}
            itemType="Configuration"
            onDelete={async () => {
              setIsDeleting(true);
              try {
                await deleteAppConfig({
                  serverId: config.serverId,
                  appConfigId: config.id,
                });
              } finally {
                setIsDeleting(false);
              }
            }}
            isDeleting={isDeleting}
            details={
              config.appIds.length > 0
                ? fallbackSentence(server, config.appIds, apps).join(" ")
                : undefined
            }
            // The confirmation closes as soon as Delete is clicked, so the
            // pending state shows on this button instead.
            trigger={
              <span className={buttonVariants({ variant: "outline" })}>
                {isDeleting ? "Deleting…" : "Delete"}
              </span>
            }
          />
        </div>
      </div>
      {showAccountHint && (
        <p className="mt-2 text-xs text-muted-foreground">
          Connecting opens your browser. If it's signed in to a different
          account than the one you want for {config.name}, sign out or switch
          accounts there first.
        </p>
      )}
      {expanded && (
        <div className="mt-2">
          <PluginConnectionPanel
            connection={config}
            catalogEntry={catalogEntry}
            catalogIsLoading={catalogIsLoading}
          />
        </div>
      )}
      {editOpen && (
        <AppConfigDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          server={server}
          appConfigs={appConfigs}
          apps={apps}
          editing={config}
          onSaved={() => {}}
        />
      )}
    </div>
  );
}

// The card's header expands and collapses it, unless the card is held
// open; then it's plain text with the chevron's space kept.
function CardHeaderToggle({
  expanded,
  onToggle,
  children,
}: {
  expanded: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  if (!onToggle) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-4 w-4 shrink-0" aria-hidden />
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="flex min-w-0 items-center gap-2 text-left"
      onClick={onToggle}
      aria-expanded={expanded}
    >
      {expanded ? (
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
      )}
      {children}
    </button>
  );
}

/** A plugin's app-specific configurations, on its detail page. */
export function PluginAppConfigsSection({
  server,
  appConfigs,
  apps,
  catalogEntry,
  catalogIsLoading,
  isLoading = false,
  loadFailed = false,
}: {
  server: McpServer;
  appConfigs: McpAppConfig[];
  apps: PickableApp[];
  catalogEntry: McpCatalogEntry | undefined;
  catalogIsLoading: boolean;
  /** The configurations haven't loaded yet. */
  isLoading?: boolean;
  /** The configurations couldn't be loaded. */
  loadFailed?: boolean;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  // Expanded configurations; one the user just created starts open so its
  // setup is in view.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 mt-6"
      data-testid="plugin-app-configs"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">App-specific configurations</h2>
          <p className="text-sm text-muted-foreground">
            Give some apps a different configuration of {server.name}, such as
            another account or credentials.
          </p>
        </div>
        <Button variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Add configuration
        </Button>
      </div>
      <div className="mt-4 space-y-3">
        {appConfigs.map((config) => {
          const { setupIncomplete } = connectionSetupState(
            config,
            catalogEntry,
            catalogIsLoading,
          );
          return (
            <AppConfigCard
              key={config.id}
              config={config}
              server={server}
              appConfigs={appConfigs}
              apps={apps}
              catalogEntry={catalogEntry}
              catalogIsLoading={catalogIsLoading}
              // A configuration still waiting for setup stays open, since
              // it can't be used until it's filled in.
              expanded={expandedIds.has(config.id) || setupIncomplete}
              onToggleExpanded={
                setupIncomplete
                  ? undefined
                  : () =>
                      setExpandedIds((current) => {
                        const next = new Set(current);
                        if (next.has(config.id)) next.delete(config.id);
                        else next.add(config.id);
                        return next;
                      })
              }
            />
          );
        })}
        {loadFailed && (
          <div className="text-xs text-destructive">
            Couldn't load this plugin's app-specific configurations.
          </div>
        )}
        {!isLoading && !loadFailed && appConfigs.length === 0 && (
          <div className="text-xs text-muted-foreground">
            No app-specific configurations. Every app that has {server.name}{" "}
            uses the default configuration.
          </div>
        )}
      </div>
      {createOpen && (
        <AppConfigDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          server={server}
          appConfigs={appConfigs}
          apps={apps}
          requiresSetup={userSuppliedInputs(catalogEntry?.inputs).some(
            isRequiredInput,
          )}
          onSaved={(created) =>
            setExpandedIds((current) => new Set(current).add(created.id))
          }
        />
      )}
    </div>
  );
}
