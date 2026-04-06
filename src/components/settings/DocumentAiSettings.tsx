import { useMemo } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useLocalModels } from "@/hooks/useLocalModels";
import { useLocalLMSModels } from "@/hooks/useLMStudioModels";
import { useLanguageModelsByProviders } from "@/hooks/useLanguageModelsByProviders";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { FileText } from "lucide-react";

export function DocumentAiSettings() {
  const { settings, updateSettings } = useSettings();
  const { models: localModels } = useLocalModels();
  const { models: lmStudioModels } = useLocalLMSModels();
  const { data: cloudModelsByProvider = {} } = useLanguageModelsByProviders();

  const currentValue = useMemo(() => {
    const dm = (settings as Record<string, unknown>).documentAiModel as
      | { provider: string; name: string }
      | undefined;
    return dm ? `${dm.provider}::${dm.name}` : "__default__";
  }, [settings]);

  const handleChange = (value: string) => {
    if (value === "__default__") {
      updateSettings({ documentAiModel: undefined } as any);
    } else {
      const [provider, ...rest] = value.split("::");
      updateSettings({ documentAiModel: { provider, name: rest.join("::") } } as any);
    }
  };

  return (
    <div
      id="document-ai-settings"
      className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6"
    >
      <div className="flex items-center gap-2 mb-4">
        <FileText className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-medium text-gray-900 dark:text-white">
          Document Studio AI
        </h2>
      </div>

      <p className="text-sm text-muted-foreground mb-5">
        Choose the AI model used for document generation and in-editor AI commands.
        Leave as "Settings default" to use the global model.
      </p>

      <div className="space-y-1.5">
        <Label>Document AI Model</Label>

        <Select value={currentValue} onValueChange={handleChange}>
          <SelectTrigger className="max-w-sm">
            <SelectValue placeholder="Settings default" />
          </SelectTrigger>

          <SelectContent className="max-h-72">
            <SelectItem value="__default__">Settings default (global model)</SelectItem>

            {localModels.length > 0 && (
              <SelectGroup>
                <SelectLabel>Local — Ollama</SelectLabel>
                {localModels.map((m) => (
                  <SelectItem key={`ollama::${m.modelName}`} value={`ollama::${m.modelName}`}>
                    {m.displayName}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}

            {lmStudioModels.length > 0 && (
              <SelectGroup>
                <SelectLabel>Local — LM Studio</SelectLabel>
                {lmStudioModels.map((m) => (
                  <SelectItem key={`lmstudio::${m.modelName}`} value={`lmstudio::${m.modelName}`}>
                    {m.displayName}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}

            {Object.entries(cloudModelsByProvider).map(([providerId, models]) =>
              models.length > 0 ? (
                <SelectGroup key={providerId}>
                  <SelectLabel className="capitalize">{providerId}</SelectLabel>
                  {models.map((m) => (
                    <SelectItem key={`${providerId}::${m.apiName}`} value={`${providerId}::${m.apiName}`}>
                      {m.displayName}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null
            )}
          </SelectContent>
        </Select>

        <p className="text-xs text-muted-foreground pt-1">
          This applies to all documents: text, spreadsheets, and presentations.
        </p>
      </div>
    </div>
  );
}
