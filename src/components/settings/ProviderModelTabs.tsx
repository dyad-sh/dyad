import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, Cpu, Server, Sparkles, Wifi, WifiOff } from "lucide-react";

import { useLanguageModelsForProvider } from "@/hooks/useLanguageModelsForProvider";
import { useLocalLMSModels } from "@/hooks/useLMStudioModels";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import {
  MODEL_PICKER_PROVIDERS,
  type ModelPickerProvider,
} from "@/lib/chat_agent_model";
import { DEFAULT_PHANTOM_MODEL } from "@/lib/ai_coder";
import type { LargeLanguageModel } from "@/lib/schemas";
import { providerSettingsRoute } from "@/routes/settings/providers/$provider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const TAB_META: Record<
  ModelPickerProvider,
  { label: string; icon: typeof Server }
> = {
  lmstudio: { label: "LM Studio", icon: Cpu },
  openrouter: { label: "OpenRouter", icon: Server },
  phantom: { label: "Phantom (Hermes)", icon: Sparkles },
};

function ConnDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        "ml-1.5 inline-block size-2 rounded-full",
        connected
          ? "bg-emerald-500 shadow-[0_0_6px_1px_rgba(16,185,129,0.5)]"
          : "bg-gray-300 dark:bg-gray-600",
      )}
      aria-hidden
    />
  );
}

function ConnLabel({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <Wifi className="size-3.5" /> Connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400">
      <WifiOff className="size-3.5" /> Not connected
    </span>
  );
}

/**
 * Clean 3-tab provider/model picker (LM Studio · OpenRouter · Phantom Hermes)
 * with connection indicators and a "Use this model" action. Controlled via the
 * current `value` and an `onSelect` callback.
 */
export function ProviderModelTabs({
  value,
  activeLabel,
  onSelect,
}: {
  value?: LargeLanguageModel;
  /** Display string for the currently-in-use model. */
  activeLabel?: string;
  onSelect: (model: LargeLanguageModel) => void;
}) {
  const navigate = useNavigate();
  const { isProviderSetup } = useLanguageModelProviders();

  const initialTab: ModelPickerProvider =
    value &&
    (MODEL_PICKER_PROVIDERS as readonly string[]).includes(value.provider)
      ? (value.provider as ModelPickerProvider)
      : "openrouter";
  const [tab, setTab] = useState<ModelPickerProvider>(initialTab);

  const orConnected = isProviderSetup("openrouter");
  const lmConnected = isProviderSetup("lmstudio");
  const connected: Record<ModelPickerProvider, boolean> = {
    lmstudio: lmConnected,
    openrouter: orConnected,
    phantom: true, // Hermes endpoint + key are built in.
  };

  // OpenRouter cloud models.
  const { data: orModels, isLoading: orLoading } = useLanguageModelsForProvider(
    tab === "openrouter" ? "openrouter" : undefined,
  );
  // LM Studio local models.
  const {
    models: lmModels,
    loading: lmLoading,
    loadModels,
  } = useLocalLMSModels();
  useEffect(() => {
    if (tab === "lmstudio" && lmConnected) void loadModels();
  }, [tab, lmConnected, loadModels]);

  // Per-tab pending selection (defaults to the active model on that provider).
  const [lmSel, setLmSel] = useState<string>("");
  const [orSel, setOrSel] = useState<string>("");
  const [phModel, setPhModel] = useState<string>(
    value?.provider === "phantom" ? value.name : DEFAULT_PHANTOM_MODEL,
  );
  useEffect(() => {
    if (value?.provider === "lmstudio") setLmSel(value.name);
    if (value?.provider === "openrouter") setOrSel(value.name);
    if (value?.provider === "phantom") setPhModel(value.name);
  }, [value]);

  const orOptions = useMemo(
    () =>
      (orModels ?? []).map((m) => ({ id: m.apiName, label: m.displayName })),
    [orModels],
  );
  const lmOptions = useMemo(
    () => lmModels.map((m) => ({ id: m.modelName, label: m.displayName })),
    [lmModels],
  );

  const isActive = (provider: ModelPickerProvider, name: string) =>
    value?.provider === provider && value?.name === name;

  return (
    <div className="space-y-3">
      {/* Active indicator */}
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900/40">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
          In use
        </span>
        <span className="font-medium text-gray-900 dark:text-white">
          {activeLabel || "—"}
        </span>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ModelPickerProvider)}>
        <TabsList className="grid w-full grid-cols-3">
          {MODEL_PICKER_PROVIDERS.map((p) => {
            const Icon = TAB_META[p].icon;
            return (
              <TabsTrigger key={p} value={p} className="gap-1.5">
                <Icon className="size-3.5" />
                <span className="hidden sm:inline">{TAB_META[p].label}</span>
                <span className="sm:hidden">
                  {TAB_META[p].label.split(" ")[0]}
                </span>
                <ConnDot connected={connected[p]} />
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* LM Studio */}
        <TabsContent value="lmstudio" className="space-y-3 pt-3">
          <ConnLabel connected={lmConnected} />
          {!lmConnected ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Start LM Studio and enable its local server, then reopen this tab
              to load your local models.
            </p>
          ) : lmLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <>
              <Select
                value={lmSel || undefined}
                onValueChange={(v) => setLmSel(v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a local model" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {lmOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!lmSel || isActive("lmstudio", lmSel)}
                onClick={() => onSelect({ provider: "lmstudio", name: lmSel })}
              >
                {isActive("lmstudio", lmSel) ? (
                  <>
                    <Check className="mr-1.5 size-4" /> In use
                  </>
                ) : (
                  "Use this model"
                )}
              </Button>
            </>
          )}
        </TabsContent>

        {/* OpenRouter */}
        <TabsContent value="openrouter" className="space-y-3 pt-3">
          <ConnLabel connected={orConnected} />
          {!orConnected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate({
                  to: providerSettingsRoute.id,
                  params: { provider: "openrouter" },
                })
              }
            >
              Connect OpenRouter
            </Button>
          ) : orLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <>
              <Select
                value={orSel || undefined}
                onValueChange={(v) => setOrSel(v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {orOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!orSel || isActive("openrouter", orSel)}
                onClick={() =>
                  onSelect({ provider: "openrouter", name: orSel })
                }
              >
                {isActive("openrouter", orSel) ? (
                  <>
                    <Check className="mr-1.5 size-4" /> In use
                  </>
                ) : (
                  "Use this model"
                )}
              </Button>
            </>
          )}
        </TabsContent>

        {/* Phantom (Hermes) */}
        <TabsContent value="phantom" className="space-y-3 pt-3">
          <ConnLabel connected />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Hermes runs against your configured Phantom endpoint (managed in AI
            Coder settings). Set the model id below.
          </p>
          <Input
            value={phModel}
            onChange={(e) => setPhModel(e.target.value)}
            placeholder={DEFAULT_PHANTOM_MODEL}
            className="font-mono text-sm"
          />
          <Button
            size="sm"
            disabled={!phModel.trim() || isActive("phantom", phModel.trim())}
            onClick={() =>
              onSelect({ provider: "phantom", name: phModel.trim() })
            }
          >
            {isActive("phantom", phModel.trim()) ? (
              <>
                <Check className="mr-1.5 size-4" /> In use
              </>
            ) : (
              "Use this model"
            )}
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
