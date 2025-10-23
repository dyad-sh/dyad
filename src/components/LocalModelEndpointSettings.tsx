import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { showError, showSuccess } from "@/lib/toast";
import type { UserSettings } from "@/lib/schemas";
import {
  DEFAULT_LM_STUDIO_ENDPOINT,
  DEFAULT_OLLAMA_ENDPOINT,
} from "@/constants/localModels";

type SavingTarget = "ollama" | "lmstudio" | null;

type EndpointKind = "ollama" | "lmstudio";

const endpointConfig: Record<
  EndpointKind,
  {
    defaultValue: string;
    label: string;
    description: string;
    successMessage: string;
    errorMessage: string;
  }
> = {
  ollama: {
    defaultValue: DEFAULT_OLLAMA_ENDPOINT,
    label: "Local model endpoint (Ollama-compatible)",
    description:
      "Used for listing and running Ollama-compatible local models, including remote hosts.",
    successMessage: "Ollama endpoint updated",
    errorMessage: "Failed to update Ollama endpoint",
  },
  lmstudio: {
    defaultValue: DEFAULT_LM_STUDIO_ENDPOINT,
    label: "LM Studio API endpoint",
    description:
      "Base URL for the LM Studio server. Trailing /v1 is optional and will be handled automatically.",
    successMessage: "LM Studio endpoint updated",
    errorMessage: "Failed to update LM Studio endpoint",
  },
};

export function LocalModelEndpointSettings() {
  const { settings, updateSettings } = useSettings();
  const [ollamaValue, setOllamaValue] = useState(DEFAULT_OLLAMA_ENDPOINT);
  const [lmStudioValue, setLmStudioValue] = useState(
    DEFAULT_LM_STUDIO_ENDPOINT,
  );
  const [saving, setSaving] = useState<SavingTarget>(null);

  useEffect(() => {
    if (settings?.ollamaEndpoint) {
      setOllamaValue(settings.ollamaEndpoint);
    } else {
      setOllamaValue(DEFAULT_OLLAMA_ENDPOINT);
    }
  }, [settings?.ollamaEndpoint]);

  useEffect(() => {
    if (settings?.lmStudioEndpoint) {
      setLmStudioValue(settings.lmStudioEndpoint);
    } else {
      setLmStudioValue(DEFAULT_LM_STUDIO_ENDPOINT);
    }
  }, [settings?.lmStudioEndpoint]);

  if (!settings) {
    return null;
  }

  const handleSave = async (kind: EndpointKind) => {
    const value = kind === "ollama" ? ollamaValue : lmStudioValue;
    const config = endpointConfig[kind];
    const trimmed = value.trim();
    const valueToPersist = trimmed.length > 0 ? trimmed : config.defaultValue;
    const payload: Partial<UserSettings> =
      kind === "ollama"
        ? { ollamaEndpoint: valueToPersist }
        : { lmStudioEndpoint: valueToPersist };

    setSaving(kind);
    try {
      await updateSettings(payload);
      if (kind === "ollama") {
        setOllamaValue(valueToPersist);
      } else {
        setLmStudioValue(valueToPersist);
      }
      showSuccess(config.successMessage);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? "Unknown error");
      showError(`${config.errorMessage}: ${message}`);
    } finally {
      setSaving(null);
    }
  };

  const handleReset = async (kind: EndpointKind) => {
    const config = endpointConfig[kind];
    const payload: Partial<UserSettings> =
      kind === "ollama"
        ? { ollamaEndpoint: config.defaultValue }
        : { lmStudioEndpoint: config.defaultValue };

    setSaving(kind);
    try {
      await updateSettings(payload);
      if (kind === "ollama") {
        setOllamaValue(config.defaultValue);
      } else {
        setLmStudioValue(config.defaultValue);
      }
      showSuccess(`${config.successMessage} (reset)`);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? "Unknown error");
      showError(`${config.errorMessage}: ${message}`);
    } finally {
      setSaving(null);
    }
  };

  const renderEndpointField = (kind: EndpointKind) => {
    const config = endpointConfig[kind];
    const value = kind === "ollama" ? ollamaValue : lmStudioValue;
    const onChange = kind === "ollama" ? setOllamaValue : setLmStudioValue;
    const isSaving = saving === kind;
    const isDefault = value === config.defaultValue;

    return (
      <div className="space-y-2">
        <div className="space-y-1">
          <Label htmlFor={`${kind}-endpoint`} className="text-sm font-medium">
            {config.label}
          </Label>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {config.description}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            id={`${kind}-endpoint`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="sm:flex-1"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex gap-2">
            <Button
              onClick={() => handleSave(kind)}
              disabled={isSaving}
              type="button"
            >
              {isSaving ? "Saving..." : "Save"}
            </Button>
            <Button
              onClick={() => handleReset(kind)}
              variant="ghost"
              disabled={isSaving || isDefault}
              type="button"
            >
              Reset
            </Button>
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Default: {config.defaultValue}
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {renderEndpointField("ollama")}
      {renderEndpointField("lmstudio")}
    </div>
  );
}
