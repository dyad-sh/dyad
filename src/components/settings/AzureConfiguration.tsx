import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, CheckCircle2 } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import type { UserSettings, AzureProviderSetting } from "@/lib/schemas";

export function AzureConfiguration() {
  const { settings, updateSettings } = useSettings();
  const existing =
    (settings?.providerSettings?.azure as AzureProviderSetting) ?? {};

  const [azureApiKey, setAzureApiKey] = useState(
    existing.azureApiKey?.value || "",
  );
  const [resourceName, setResourceName] = useState(existing.resourceName || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setAzureApiKey(existing.azureApiKey?.value || "");
    setResourceName(existing.resourceName || "");
  }, [settings?.providerSettings?.azure]);

  const onSave = async () => {
    setError(null);
    setSaved(false);

    try {
      // Validate that both fields have values
      if (azureApiKey && resourceName) {
        JSON.parse("{}"); // Simple validation placeholder
      }
    } catch (e: any) {
      setError("Invalid configuration: " + e.message);
      return;
    }

    setSaving(true);
    try {
      const settingsUpdate: Partial<UserSettings> = {
        providerSettings: {
          ...settings?.providerSettings,
          azure: {
            ...existing,
            azureApiKey: azureApiKey.trim() ? { value: azureApiKey.trim() } : undefined,
            resourceName: resourceName.trim() || undefined,
          },
        },
      };
      await updateSettings(settingsUpdate);
      setSaved(true);
    } catch (e: any) {
      setError(e?.message || "Failed to save Azure settings");
    } finally {
      setSaving(false);
    }
  };

  const isConfigured = Boolean(
    (azureApiKey.trim() && resourceName.trim()) ||
      (existing.azureApiKey?.value?.trim() && existing.resourceName?.trim()),
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            Azure Resource Name
          </label>
          <Input
            value={resourceName}
            onChange={(e) => setResourceName(e.target.value)}
            placeholder="your-azure-openai-resource"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            The name you gave your Azure OpenAI resource in the Azure portal
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Azure API Key
          </label>
          <Input
            type="password"
            value={azureApiKey}
            onChange={(e) => setAzureApiKey(e.target.value)}
            placeholder="Enter your Azure OpenAI API key"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Get this from Keys and Endpoint in your Azure OpenAI resource
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={onSave} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
        {saved && !error && (
          <span className="flex items-center text-green-600 text-sm">
            <CheckCircle2 className="h-4 w-4 mr-1" /> Saved
          </span>
        )}
      </div>

      {!isConfigured && (
        <Alert variant="default">
          <Info className="h-4 w-4" />
          <AlertTitle>Configuration Required</AlertTitle>
          <AlertDescription>
            Provide both Azure Resource Name and API Key to use Azure OpenAI
            models.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Save Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
