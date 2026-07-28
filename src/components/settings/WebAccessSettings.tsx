import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import {
  WEB_SEARCH_BRAVE_PROVIDER_ID,
  WEB_SEARCH_EXA_PROVIDER_ID,
} from "@/lib/schemas";
import { showError, showSuccess } from "@/lib/toast";

type SearchProviderId =
  | typeof WEB_SEARCH_EXA_PROVIDER_ID
  | typeof WEB_SEARCH_BRAVE_PROVIDER_ID;

function maskKey(value: string | undefined): string {
  if (!value) return "Not configured";
  if (value.length < 12) return "********";
  return `${value.slice(0, 4)}********${value.slice(-4)}`;
}

function ApiKeySetting({
  label,
  providerId,
  savedValue,
  onSave,
}: {
  label: string;
  providerId: SearchProviderId;
  savedValue?: string;
  onSave: (
    providerId: SearchProviderId,
    value: string | undefined,
  ) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    const apiKey = value.trim();
    if (!apiKey) return;
    setIsSaving(true);
    try {
      await onSave(providerId, apiKey);
      setValue("");
      showSuccess(`${label} saved`);
    } catch (error) {
      showError(
        error instanceof Error ? error.message : `Failed to save ${label}`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    setIsSaving(true);
    try {
      await onSave(providerId, undefined);
      showSuccess(`${label} deleted`);
    } catch (error) {
      showError(
        error instanceof Error ? error.message : `Failed to delete ${label}`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-border/60 pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${providerId}-key`}>{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">
          {maskKey(savedValue)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={`${providerId}-key`}
            aria-label={`${label} value`}
            type="password"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={
              savedValue ? "Enter a replacement key" : "Enter API key"
            }
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={isSaving || !value.trim()}
        >
          <Save />
          Save
        </Button>
        {savedValue && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={remove}
            disabled={isSaving}
          >
            <Trash2 />
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

export function WebAccessSettings() {
  const { settings, updateSettings } = useSettings();
  const enabled = settings?.enableWebAccess === true;
  const settingsRef = useRef(settings);
  const updateQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const updateApiKey = useCallback(
    (providerId: SearchProviderId, value: string | undefined) => {
      const update = updateQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const currentSettings = settingsRef.current;
          const currentProvider =
            currentSettings?.providerSettings[providerId] ?? {};
          const updatedSettings = await updateSettings({
            providerSettings: {
              ...currentSettings?.providerSettings,
              [providerId]: {
                ...currentProvider,
                apiKey: value === undefined ? undefined : { value },
              },
            },
          });
          settingsRef.current = updatedSettings;
        });
      updateQueueRef.current = update;
      return update;
    },
    [updateSettings],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="web-access">Web access</Label>
          <p className="text-[13px] text-muted-foreground">
            Allow the agent to search and read public web pages.
          </p>
        </div>
        <Switch
          id="web-access"
          aria-label="Web access"
          checked={enabled}
          onCheckedChange={(checked) =>
            updateSettings({ enableWebAccess: checked })
          }
        />
      </div>

      {enabled && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-4">
            <Label htmlFor="web-search-provider">Search provider</Label>
            <Select
              value={settings?.webSearchProvider ?? "auto"}
              onValueChange={(value) => {
                if (value === "auto" || value === "exa" || value === "brave") {
                  updateSettings({ webSearchProvider: value });
                }
              }}
            >
              <SelectTrigger id="web-search-provider" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="exa">Exa</SelectItem>
                <SelectItem value="brave">Brave</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ApiKeySetting
            label="Exa API key"
            providerId={WEB_SEARCH_EXA_PROVIDER_ID}
            savedValue={
              settings?.providerSettings[WEB_SEARCH_EXA_PROVIDER_ID]?.apiKey
                ?.value
            }
            onSave={updateApiKey}
          />
          <ApiKeySetting
            label="Brave Search API key"
            providerId={WEB_SEARCH_BRAVE_PROVIDER_ID}
            savedValue={
              settings?.providerSettings[WEB_SEARCH_BRAVE_PROVIDER_ID]?.apiKey
                ?.value
            }
            onSave={updateApiKey}
          />
        </div>
      )}
    </div>
  );
}
