import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMcp } from "@/hooks/useMcp";
import type { McpAppConfig, McpServer } from "@/ipc/types";
import { PluginAppPicker, type PickableApp } from "./PluginAppPicker";

type Scope = McpServer["defaultScope"];

function scopeLabel(scope: Scope, hasAppConfigs: boolean): string {
  switch (scope) {
    case "all":
      return hasAppConfigs ? "All other apps" : "All apps";
    case "selected":
      return "Only these apps…";
    case "none":
      return "No apps";
  }
}

function sameIds(a: ReadonlySet<number>, b: readonly number[]): boolean {
  return a.size === b.length && b.every((id) => a.has(id));
}

/**
 * Which apps the plugin's default configuration serves. An app with an
 * app-specific configuration always uses that instead, whatever this says.
 */
export function PluginDefaultAvailability({
  server,
  appConfigs,
  apps,
}: {
  server: McpServer;
  appConfigs: McpAppConfig[];
  apps: PickableApp[];
}) {
  const { setPluginAvailability, isSavingAppScope } = useMcp();
  const [draftScope, setDraftScope] = useState<Scope>(server.defaultScope);
  const [draftApps, setDraftApps] = useState<Set<number>>(
    () => new Set(server.defaultAppIds),
  );
  // Follow saved changes, including ones made in another window. Keyed by
  // value: every refetch returns a new array.
  const savedAppIdsKey = server.defaultAppIds.join(",");
  useEffect(() => {
    setDraftScope(server.defaultScope);
    setDraftApps(new Set(server.defaultAppIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value
  }, [server.defaultScope, savedAppIdsKey]);

  const configByApp = new Map<number, McpAppConfig>();
  for (const config of appConfigs) {
    for (const appId of config.appIds) configByApp.set(appId, config);
  }

  const save = (scope: Scope, appIds: Set<number>) =>
    setPluginAvailability({
      serverId: server.id,
      defaultScope: scope,
      defaultAppIds: [...appIds],
    }).catch(() => {
      // The mutation shows its own error toast; return to the saved state.
      setDraftScope(server.defaultScope);
      setDraftApps(new Set(server.defaultAppIds));
    });

  const appListChanged =
    draftScope === "selected" &&
    (server.defaultScope !== "selected" ||
      !sameIds(draftApps, server.defaultAppIds));

  return (
    <div className="mt-3 space-y-2" data-testid="plugin-default-availability">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Used by</span>
        <Select
          value={draftScope}
          disabled={isSavingAppScope}
          onValueChange={(value) => {
            if (value === null) return;
            const scope = value as Scope;
            setDraftScope(scope);
            // "Only these apps" waits for the list to be chosen and saved.
            if (scope !== "selected") void save(scope, draftApps);
          }}
        >
          <SelectTrigger
            className="w-[200px] h-8"
            aria-label="Apps that use the default configuration"
          >
            <SelectValue>
              {scopeLabel(draftScope, appConfigs.length > 0)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(["all", "selected", "none"] as const).map((scope) => (
              <SelectItem key={scope} value={scope}>
                {scopeLabel(scope, appConfigs.length > 0)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {draftScope === "none" && (
        <p className="text-xs text-muted-foreground">
          Not used: apps without their own configuration won't have{" "}
          {server.name}.
        </p>
      )}
      {draftScope === "selected" && (
        <>
          <PluginAppPicker
            apps={apps}
            selected={draftApps}
            onChange={setDraftApps}
            disabled={isSavingAppScope}
            noteFor={(appId) => {
              const config = configByApp.get(appId);
              return config ? `uses ${config.name}` : undefined;
            }}
          />
          {appListChanged && (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={isSavingAppScope}
                onClick={() => {
                  setDraftScope(server.defaultScope);
                  setDraftApps(new Set(server.defaultAppIds));
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isSavingAppScope}
                onClick={() => void save("selected", draftApps)}
              >
                Save
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
