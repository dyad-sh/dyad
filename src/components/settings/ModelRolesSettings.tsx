import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Braces,
  Check,
  ChevronDown,
  CircleGauge,
  Code2,
  Image,
  Loader2,
  MessageSquare,
  Network,
  RotateCcw,
  ScanText,
  Search,
  Server,
  Sparkles,
  TestTube2,
  Video,
} from "lucide-react";

import { ipc, type DiscoveredLocalModelServer } from "@/ipc/types";
import { useSettingsInternal } from "@/hooks/useSettings";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useLanguageModelsByProviders } from "@/hooks/useLanguageModelsByProviders";
import { useOpenRouterImageModels } from "@/hooks/useOpenRouterImageModels";
import { queryKeys } from "@/lib/queryKeys";
import {
  MODEL_ROLES,
  MODEL_ROLE_META,
  createRoleModelOption,
  inferModelCapabilities,
  isModelSuitableForRole,
  modelOptionKey,
  selectBestModelForRole,
  selectableModelsForRole,
  type ModelCapability,
  type RoleModelOption,
} from "@/lib/model_roles";
import type {
  LargeLanguageModel,
  ModelRole,
  ModelRoleAssignment,
  UserSettings,
} from "@/lib/schemas";
import { DEFAULT_VIDEO_MODEL } from "@/ipc/types/video_generation";
import { NANO_BANANA_2_MODEL } from "@/ipc/types/image_generation";
import { SECTION_IDS } from "@/lib/settingsSearchIndex";
import { showError, showSuccess } from "@/lib/toast";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { isProviderVisibleInSettings } from "@/lib/settings_provider_visibility";

const ROLE_ICONS: Record<ModelRole, typeof MessageSquare> = {
  chat: MessageSquare,
  image: Image,
  coding: Code2,
  video: Video,
  embeddings: Braces,
  ocr: ScanText,
};

const CAPABILITY_STYLES: Record<ModelCapability, string> = {
  Text: "border-sky-400/20 bg-sky-500/8 text-sky-200/70",
  Vision: "border-violet-400/20 bg-violet-500/8 text-violet-200/70",
  "Image Generation":
    "border-fuchsia-400/20 bg-fuchsia-500/8 text-fuchsia-200/70",
  Video: "border-pink-400/20 bg-pink-500/8 text-pink-200/70",
  "Tool Calling": "border-amber-400/20 bg-amber-500/8 text-amber-200/70",
  Coding: "border-cyan-400/20 bg-cyan-500/8 text-cyan-200/70",
  Embeddings: "border-indigo-400/20 bg-indigo-500/8 text-indigo-200/70",
  OCR: "border-purple-400/20 bg-purple-500/8 text-purple-200/70",
  Reasoning: "border-blue-400/20 bg-blue-500/8 text-blue-200/70",
  Local: "border-emerald-400/20 bg-emerald-500/8 text-emerald-200/70",
  Cloud: "border-slate-400/20 bg-slate-500/8 text-slate-200/70",
};

function capabilityBadge(capability: ModelCapability) {
  return (
    <Badge
      key={capability}
      variant="outline"
      className={cn(
        "h-5 rounded-md px-1.5 text-[9px] font-medium uppercase tracking-wide",
        CAPABILITY_STYLES[capability],
      )}
    >
      {capability}
    </Badge>
  );
}

function legacyModelForRole(
  role: ModelRole,
  settings: UserSettings,
): LargeLanguageModel | undefined {
  if (role === "chat") return settings.chatAgentModel ?? settings.selectedModel;
  if (role === "coding") return settings.selectedModel;
  if (role === "image") {
    return {
      provider: "openrouter",
      name: settings.imageAgentModel ?? NANO_BANANA_2_MODEL,
    };
  }
  if (role === "video") {
    return {
      provider: "fal",
      name: settings.videoAgentModel ?? DEFAULT_VIDEO_MODEL,
    };
  }
  return undefined;
}

function legacyPatchForRole(
  role: ModelRole,
  model: LargeLanguageModel,
): Partial<UserSettings> {
  if (role === "chat") return { chatAgentModel: model };
  if (role === "coding") return { selectedModel: model };
  if (role === "image") return { imageAgentModel: model.name };
  if (role === "video") return { videoAgentModel: model.name };
  return {};
}

function optionFromLocalModel(
  // Any local server the app discovered. Every one of them offers its models
  // to the role pickers on the same terms.
  provider: "ollama" | "lmstudio" | "mx_serve",
  providerName: string,
  model: {
    modelName: string;
    displayName: string;
    sizeBytes?: number;
    parameterSize?: string;
    quantization?: string;
    contextWindow?: number;
  },
  server?: Pick<DiscoveredLocalModelServer, "url" | "latencyMs">,
): RoleModelOption {
  const base = {
    provider,
    providerName,
    name: model.modelName,
    displayName: model.displayName,
    local: true,
    serverUrl: server?.url,
    latencyMs: server?.latencyMs,
    sizeBytes: model.sizeBytes,
    parameterSize: model.parameterSize,
    quantization: model.quantization,
    contextWindow: model.contextWindow,
  };
  return { ...base, capabilities: inferModelCapabilities(base) };
}

function formatBytes(bytes?: number) {
  if (!bytes) return "Unknown";
  const gb = bytes / 1024 ** 3;
  return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
}

function ModelSelector({
  role,
  models,
  selected,
  providerName,
  onSelect,
}: {
  role: ModelRole;
  models: RoleModelOption[];
  selected?: RoleModelOption;
  providerName?: string;
  onSelect: (model: RoleModelOption) => void;
}) {
  const [open, setOpen] = useState(false);

  /**
   * Recommended first, then the rest.
   *
   * The split is the capability inference doing what it is actually good for:
   * pointing at the likely answer without deciding for the person. A provider
   * whose models it cannot classify still shows its whole catalogue.
   */
  const groups = useMemo(() => {
    const from = providerName ? ` from ${providerName}` : "";
    const recommended = models.filter((model) =>
      isModelSuitableForRole(model, role),
    );
    const others = models.filter(
      (model) => !isModelSuitableForRole(model, role),
    );
    return [
      recommended.length > 0
        ? {
            heading: `Recommended for ${MODEL_ROLE_META[role].label}${from}`,
            items: recommended,
          }
        : null,
      others.length > 0
        ? {
            heading:
              recommended.length > 0
                ? `Other models${from}`
                : `All models${from}`,
            items: others,
          }
        : null,
    ].filter((group): group is { heading: string; items: RoleModelOption[] } =>
      Boolean(group),
    );
  }, [models, role, providerName]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-10 w-full justify-between border-cyan-500/15 bg-cyan-950/20 px-3 py-2 text-left hover:border-cyan-400/35 hover:bg-cyan-500/8"
        onClick={() => setOpen(true)}
        disabled={models.length === 0}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? (
            <ProviderIcon providerId={selected.provider} className="size-4" />
          ) : (
            <Search className="size-4 text-cyan-100/35" />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm text-cyan-50/85">
              {selected?.displayName ??
                (models.length > 0 ? "Choose a model" : "No model available")}
            </span>
            {selected && (
              <span className="block truncate text-[10px] text-cyan-100/35">
                {selected.providerName} · {selected.name}
              </span>
            )}
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-cyan-100/35" />
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={`Choose a ${MODEL_ROLE_META[role].label} model`}
        description="Models from the selected provider. Recommended ones are listed first."
        className="border-cyan-400/25 bg-[#06111f] text-cyan-50 shadow-[0_0_36px_rgba(0,229,255,0.14)] [&_[data-slot=command]]:bg-[#06111f] [&_[data-slot=command-input-wrapper]]:border-cyan-400/15 [&_[data-slot=command-input]]:text-cyan-50"
      >
        <CommandInput placeholder="Search models…" />
        <CommandList className="scrollbar-on-hover max-h-96">
          <CommandEmpty className="text-cyan-100/45">
            No models found for this provider.
          </CommandEmpty>
          {groups.map(({ heading, items }) => (
            <CommandGroup
              key={heading}
              heading={heading}
              className="[&_[cmdk-group-heading]]:text-cyan-100/40"
            >
              {items.map((model) => (
                <CommandItem
                  key={`${modelOptionKey(model)}:${model.serverUrl ?? ""}`}
                  value={`${model.displayName} ${model.name} ${model.providerName}`}
                  onSelect={() => {
                    onSelect(model);
                    setOpen(false);
                  }}
                  className="items-start rounded-lg border border-transparent py-2.5 text-cyan-50/85 data-[selected=true]:!border-cyan-400/20 data-[selected=true]:!bg-cyan-400/10 data-[selected=true]:!text-cyan-50"
                >
                  <ProviderIcon
                    providerId={model.provider}
                    apiName={model.name}
                    className="mt-0.5 size-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {model.displayName}
                      </span>
                      {selected &&
                        modelOptionKey(selected) === modelOptionKey(model) && (
                          <Check className="size-3.5 text-emerald-400" />
                        )}
                    </span>
                    <span className="block truncate text-xs text-cyan-100/40">
                      {model.name}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {model.capabilities.slice(0, 5).map(capabilityBadge)}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}

function ProviderModelSelector({
  role,
  models,
  selected,
  onSelect,
}: {
  role: ModelRole;
  models: RoleModelOption[];
  selected?: RoleModelOption;
  onSelect: (model: RoleModelOption) => void;
}) {
  const providers = useMemo(() => {
    const byProvider = new Map<
      string,
      { id: string; name: string; modelCount: number }
    >();
    for (const model of models) {
      const existing = byProvider.get(model.provider);
      if (existing) {
        existing.modelCount += 1;
      } else {
        byProvider.set(model.provider, {
          id: model.provider,
          name: model.providerName,
          modelCount: 1,
        });
      }
    }
    return [...byProvider.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [models]);
  const providerIds = providers.map((provider) => provider.id).join("|");
  const [providerId, setProviderId] = useState(
    selected?.provider ?? providers[0]?.id ?? "",
  );

  useEffect(() => {
    if (
      selected?.provider &&
      providers.some((provider) => provider.id === selected.provider)
    ) {
      setProviderId(selected.provider);
      return;
    }
    if (!providers.some((provider) => provider.id === providerId)) {
      setProviderId(providers[0]?.id ?? "");
    }
    // providerIds captures provider availability without resetting a user's
    // in-progress provider choice when only model metadata changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.provider, providerIds]);

  const provider = providers.find((item) => item.id === providerId);
  const providerModels = models.filter(
    (model) => model.provider === providerId,
  );
  const selectedModel =
    selected?.provider === providerId ? selected : undefined;

  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <label className="min-w-0">
        <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.12em] text-cyan-100/45">
          Provider
        </span>
        <Select
          value={providerId || null}
          onValueChange={(value) => {
            if (value) setProviderId(value);
          }}
          disabled={providers.length === 0}
        >
          <SelectTrigger className="h-auto min-h-10 w-full border-cyan-500/15 bg-cyan-950/20 px-3 py-2 text-cyan-50/85 hover:border-cyan-400/35 hover:bg-cyan-500/8">
            <SelectValue>
              {provider ? (
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderIcon
                    providerId={provider.id}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-sm">
                      {provider.name}
                    </span>
                    <span className="block text-[10px] text-cyan-100/35">
                      {provider.modelCount}{" "}
                      {provider.modelCount === 1 ? "model" : "models"}
                    </span>
                  </span>
                </span>
              ) : (
                "No provider available"
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            align="start"
            className="scrollbar-on-hover border-cyan-400/20 bg-[#06111f] text-cyan-50 shadow-[0_0_30px_rgba(0,229,255,0.12)]"
          >
            {providers.map((item) => (
              <SelectItem
                key={item.id}
                value={item.id}
                className="focus:!bg-cyan-400/10 focus:!text-cyan-50"
              >
                <ProviderIcon providerId={item.id} className="size-4" />
                <span>{item.name}</span>
                <span className="text-xs text-cyan-100/35">
                  {item.modelCount}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <div className="min-w-0">
        <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.12em] text-cyan-100/45">
          Model
        </span>
        <ModelSelector
          role={role}
          models={providerModels}
          selected={selectedModel}
          providerName={provider?.name}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

function RoleCard({
  role,
  models,
  assignment,
  legacyModel,
  onChange,
}: {
  role: ModelRole;
  models: RoleModelOption[];
  assignment?: ModelRoleAssignment;
  legacyModel?: LargeLanguageModel;
  onChange: (assignment: ModelRoleAssignment, model: RoleModelOption) => void;
}) {
  const Icon = ROLE_ICONS[role];
  // Every model from every active provider, except for the gated roles.
  // Auto-select below still reasons about capability; this is only what the
  // person is allowed to choose for themselves.
  const selectable = useMemo(
    () => selectableModelsForRole(models, role),
    [models, role],
  );
  const best = useMemo(
    () => selectBestModelForRole(models, role),
    [models, role],
  );
  const configuredModel = assignment?.model ?? legacyModel;
  const manuallySelected = selectable.find(
    (model) =>
      configuredModel &&
      model.provider === configuredModel.provider &&
      model.name === configuredModel.name,
  );
  const auto = assignment?.auto ?? true;
  const selected = auto ? best : manuallySelected;
  const unavailable = !auto && configuredModel && !manuallySelected;

  /**
   * Where the assignment does not reach, stated plainly.
   *
   * Image generation posts to OpenRouter whichever model is assigned, and the
   * embedding model that vector search actually uses is configured with the
   * workspace, not here. Neither is a new limit; both were previously hidden
   * by a picker that offered nothing else.
   */
  const runtimeNote =
    role === "image" && selected && selected.provider !== "openrouter"
      ? `Image generation currently sends every request to OpenRouter, so a ${selected.providerName} model will not be reached.`
      : role === "embeddings" && selected
        ? "Vector search uses the embedding model configured in the Vector workspace; this assignment does not change it."
        : null;

  const persist = (model: RoleModelOption, nextAuto: boolean) =>
    onChange(
      {
        auto: nextAuto,
        model: { provider: model.provider, name: model.name },
      },
      model,
    );

  const testModel = () => {
    if (!selected) {
      showError(
        `No compatible ${MODEL_ROLE_META[role].label} model is online.`,
      );
      return;
    }
    if (selected.local) {
      const target =
        selected.serverUrl ??
        (selected.provider === "ollama"
          ? "http://localhost:11434"
          : "http://localhost:1234");
      void ipc.languageModel
        .discoverLocalServers({ scanLocalSubnet: false, targets: [target] })
        .then(({ servers }) => {
          const available = servers.some(
            (server) =>
              server.provider === selected.provider &&
              server.models.some((model) => model.modelName === selected.name),
          );
          if (!available) {
            showError(`${selected.displayName} is not currently reachable.`);
            return;
          }
          showSuccess(
            `${selected.displayName} is online at ${new URL(target).host}.`,
          );
        })
        .catch((error) =>
          showError(
            error instanceof Error ? error.message : "Model test failed.",
          ),
        );
      return;
    }
    showSuccess(
      `${selected.displayName} is available from ${selected.providerName}.`,
    );
  };

  return (
    <AccordionItem
      value={role}
      className="overflow-hidden rounded-xl border border-cyan-500/15 bg-[rgba(6,18,34,0.74)] shadow-[0_0_18px_rgba(0,229,255,0.04)]"
    >
      <AccordionTrigger className="items-center px-4 py-3.5 hover:no-underline">
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-cyan-400/20 bg-cyan-500/10 text-cyan-300">
            <Icon className="size-4.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-cyan-50">
                  {MODEL_ROLE_META[role].label}
                </span>
                <span className="block truncate text-xs font-normal text-cyan-100/40">
                  {selected
                    ? `${selected.providerName} · ${selected.displayName}`
                    : MODEL_ROLE_META[role].description}
                </span>
              </span>
              <span
                className={cn(
                  "mr-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-wide",
                  selected
                    ? "border-emerald-400/20 bg-emerald-500/8 text-emerald-300/80"
                    : "border-amber-400/20 bg-amber-500/8 text-amber-200/75",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    selected ? "bg-emerald-400" : "bg-amber-400",
                  )}
                />
                {selected ? (auto ? "Auto" : "Assigned") : "Unavailable"}
              </span>
            </span>
          </span>
        </span>
      </AccordionTrigger>

      <AccordionContent className="border-t border-cyan-500/10 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <div>
            <h3 className="font-jarvis-display text-base font-semibold text-cyan-50">
              {MODEL_ROLE_META[role].label}
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-cyan-100/40">
              {MODEL_ROLE_META[role].description}
            </p>
          </div>

          <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-cyan-500/10 bg-cyan-950/20 px-3 py-2.5">
            <div>
              <p className="text-xs font-medium text-cyan-50/80">
                Auto Select Best Model
              </p>
              <p className="text-[10px] text-cyan-100/35">
                Balances capability, privacy, context, and latency.
              </p>
            </div>
            <Switch
              checked={auto}
              disabled={!best}
              onCheckedChange={(checked) => {
                const model = checked ? best : (selected ?? best);
                if (model) persist(model, checked);
              }}
              aria-label={`Auto select ${MODEL_ROLE_META[role].label} model`}
            />
          </div>

          <div className="mt-3">
            <ProviderModelSelector
              role={role}
              models={selectable}
              selected={selected}
              onSelect={(model) => persist(model, false)}
            />
          </div>

          {unavailable && (
            <p className="mt-2 text-xs text-amber-300/75">
              Your assigned model is offline. Enable Auto Select to use the next
              compatible model.
            </p>
          )}

          {/* The picker offers every connected provider, but two roles are
              narrower at runtime than they now look here. Saying so at the
              point of choice beats a failure later that names no cause. */}
          {runtimeNote && (
            <p className="mt-2 text-xs text-amber-300/75">{runtimeNote}</p>
          )}

          {selected && (
            <div className="mt-3 flex flex-wrap gap-1">
              {selected.capabilities.map(capabilityBadge)}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={testModel}
              disabled={!selected}
              className="border-cyan-500/15 bg-cyan-500/5 text-cyan-100/70 hover:bg-cyan-500/10 hover:text-cyan-50"
            >
              <TestTube2 className="size-3.5" />
              Test Model
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => best && persist(best, true)}
              disabled={!best}
              className="text-cyan-100/45 hover:bg-cyan-500/8 hover:text-cyan-100"
            >
              <RotateCcw className="size-3.5" />
              Reset to Default
            </Button>
          </div>

          {selected && (
            <details className="group mt-3">
              <summary className="cursor-pointer list-none text-[11px] font-medium text-cyan-100/40 hover:text-cyan-100/65">
                <span className="inline-flex items-center gap-1">
                  <CircleGauge className="size-3.5" />
                  Advanced model details
                  <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                </span>
              </summary>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-cyan-500/10 bg-black/10 p-3 text-[11px]">
                <div>
                  <dt className="text-cyan-100/30">Provider</dt>
                  <dd className="text-cyan-50/65">{selected.providerName}</dd>
                </div>
                <div>
                  <dt className="text-cyan-100/30">Hosting</dt>
                  <dd className="text-cyan-50/65">
                    {selected.local ? "Local network" : "Cloud"}
                  </dd>
                </div>
                <div>
                  <dt className="text-cyan-100/30">Context window</dt>
                  <dd className="text-cyan-50/65">
                    {selected.contextWindow?.toLocaleString() ?? "Not reported"}
                  </dd>
                </div>
                <div>
                  <dt className="text-cyan-100/30">Latency</dt>
                  <dd className="text-cyan-50/65">
                    {selected.latencyMs ? `${selected.latencyMs} ms` : "Live"}
                  </dd>
                </div>
              </dl>
            </details>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function LocalDiscovery({
  servers,
  onServers,
  onApprove,
  savedTargets,
}: {
  servers: DiscoveredLocalModelServer[];
  onServers: (servers: DiscoveredLocalModelServer[]) => void;
  onApprove: (server: DiscoveredLocalModelServer) => void;
  savedTargets: string[];
}) {
  const [manualTarget, setManualTarget] = useState("");
  const [scanSubnet, setScanSubnet] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [scannedHosts, setScannedHosts] = useState<number | null>(null);

  const discover = async () => {
    setDiscovering(true);
    try {
      const result = await ipc.languageModel.discoverLocalServers({
        scanLocalSubnet: scanSubnet,
        targets: [
          ...savedTargets,
          ...(manualTarget.trim() ? [manualTarget.trim()] : []),
        ],
      });
      onServers(result.servers);
      setScannedHosts(result.scannedHostCount);
      if (result.servers.length === 0) {
        showError("No LM Studio or Ollama servers responded.");
      } else {
        showSuccess(`Found ${result.servers.length} local model server(s).`);
      }
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Local discovery failed.",
      );
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <AccordionItem
      value="local-discovery"
      className="overflow-hidden rounded-xl border border-cyan-500/15 bg-[rgba(6,18,34,0.74)] shadow-[0_0_18px_rgba(0,229,255,0.04)]"
    >
      <AccordionTrigger className="items-center px-4 py-3.5 hover:no-underline">
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-emerald-400/20 bg-emerald-500/8 text-emerald-300">
            <Network className="size-4.5" />
          </span>
          <span className="min-w-0 text-left">
            <span className="block text-sm font-medium text-cyan-50">
              Discover Local Models
            </span>
            <span className="block truncate text-xs font-normal text-cyan-100/40">
              LM Studio, Ollama, and OpenAI-compatible servers
            </span>
          </span>
        </span>
      </AccordionTrigger>

      <AccordionContent className="border-t border-cyan-500/10 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <p className="text-xs leading-relaxed text-cyan-100/40">
            Find LM Studio, Ollama, and OpenAI-compatible servers on this
            computer or your private local network. Discovered servers require
            approval before they are saved.
          </p>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Input
              value={manualTarget}
              onChange={(event) => setManualTarget(event.target.value)}
              placeholder="Optional server URL or IP:port"
              className="border-cyan-500/15 bg-cyan-950/20 font-mono text-sm"
            />
            <Button
              type="button"
              onClick={() => void discover()}
              disabled={discovering}
              className="shrink-0"
            >
              {discovering ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              {discovering ? "Discovering" : "Discover"}
            </Button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-cyan-500/10 px-3 py-2">
            <div>
              <p className="text-xs text-cyan-50/70">Scan local subnet</p>
              <p className="text-[10px] text-cyan-100/30">
                Checks only private IPv4 addresses on ports 11434 and 1234.
              </p>
            </div>
            <Switch
              checked={scanSubnet}
              onCheckedChange={setScanSubnet}
              aria-label="Scan private local subnet"
            />
          </div>

          {scannedHosts !== null && (
            <p className="mt-2 text-[10px] text-cyan-100/30">
              Checked {scannedHosts} host{scannedHosts === 1 ? "" : "s"}.
            </p>
          )}

          {servers.length > 0 && (
            <div className="mt-4 space-y-2">
              {servers.map((server) => (
                <div
                  key={`${server.provider}:${server.url}`}
                  className="rounded-xl border border-cyan-500/12 bg-cyan-950/20 p-3"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium text-cyan-50/80">
                        <ProviderIcon providerId={server.provider} />
                        {server.name}
                      </p>
                      <p className="mt-1 truncate font-mono text-[10px] text-cyan-100/35">
                        {server.host}:{server.port} · {server.latencyMs} ms ·{" "}
                        {server.models.length} models
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onApprove(server)}
                      className="shrink-0 border-emerald-400/20 bg-emerald-500/8 text-emerald-200/75 hover:bg-emerald-500/12"
                    >
                      <Check className="size-3.5" />
                      Approve &amp; use
                    </Button>
                  </div>
                  {server.models.length > 0 && (
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      {server.models.slice(0, 6).map((model) => (
                        <div
                          key={model.modelName}
                          className="truncate rounded-md bg-black/10 px-2 py-1.5 text-[10px] text-cyan-100/45"
                        >
                          {model.displayName} ·{" "}
                          {model.parameterSize ?? "size unknown"} ·{" "}
                          {model.quantization ?? "quantisation unknown"} ·{" "}
                          {formatBytes(model.sizeBytes)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export function ModelRolesSettings() {
  // Model assignments are runtime routing decisions, so persist them
  // immediately instead of leaving them in the Settings draft overlay. This
  // keeps the role card, chat composer label, and main-process routing aligned.
  const { settings, updateSettings } = useSettingsInternal();
  const {
    data: providers,
    isProviderSetup,
    isLoading: providersLoading,
  } = useLanguageModelProviders();
  const { data: modelsByProvider, isLoading: modelsLoading } =
    useLanguageModelsByProviders();
  const { data: imageModels } = useOpenRouterImageModels();
  const [discoveredServers, setDiscoveredServers] = useState<
    DiscoveredLocalModelServer[]
  >([]);
  const savedLocalTargets = useMemo(
    () =>
      [
        (
          settings?.providerSettings.ollama as
            | { apiBaseUrl?: string }
            | undefined
        )?.apiBaseUrl,
        (
          settings?.providerSettings.lmstudio as
            | { apiBaseUrl?: string }
            | undefined
        )?.apiBaseUrl,
        // Without this, a configured MX Serve was never handed to discovery,
        // so its models never reached the role pickers.
        (
          settings?.providerSettings.mx_serve as
            | { apiBaseUrl?: string }
            | undefined
        )?.apiBaseUrl,
      ].filter((url): url is string => Boolean(url)),
    [settings?.providerSettings],
  );
  const savedLocalTargetsKey = savedLocalTargets.join("|");

  const videoStatus = useQuery({
    queryKey: queryKeys.videoGeneration.status,
    queryFn: () => ipc.videoGeneration.status(),
  });
  const videoModels = useQuery({
    queryKey: queryKeys.videoGeneration.models,
    queryFn: () => ipc.videoGeneration.listModels(),
  });

  useEffect(() => {
    void ipc.languageModel
      .discoverLocalServers({
        scanLocalSubnet: false,
        targets: savedLocalTargets,
      })
      .then(({ servers }) => setDiscoveredServers(servers))
      .catch(() => {
        // Local providers are optional; the explicit Discover action surfaces errors.
      });
    // The joined value avoids rediscovery when only the settings object identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedLocalTargetsKey]);

  const allModels = useMemo(() => {
    const output: RoleModelOption[] = [];
    const providerNames = new Map(
      providers?.map((provider) => [provider.id, provider.name]) ?? [],
    );

    for (const [providerId, models] of Object.entries(modelsByProvider ?? {})) {
      if (!isProviderVisibleInSettings(providerId)) continue;
      if (!isProviderSetup(providerId)) continue;
      const provider = providers?.find((item) => item.id === providerId);
      if (provider?.type === "local") continue;
      for (const model of models) {
        output.push(
          createRoleModelOption({
            provider: providerId,
            providerName: providerNames.get(providerId) ?? providerId,
            model,
            local: false,
          }),
        );
      }
    }

    // One entry per provider-and-model. IPv4 and IPv6 loopback usually reach
    // the same process, so a dual-stack server is discovered twice and would
    // otherwise offer every model of its twice over.
    const seenLocalModels = new Set<string>();
    for (const server of discoveredServers) {
      for (const model of server.models) {
        const key = `${server.provider}:${model.modelName}`;
        if (seenLocalModels.has(key)) continue;
        seenLocalModels.add(key);
        output.push(
          optionFromLocalModel(server.provider, server.name, model, server),
        );
      }
    }

    if (isProviderSetup("openrouter")) {
      for (const model of imageModels?.models ?? []) {
        output.push({
          provider: "openrouter",
          providerName: "OpenRouter",
          name: model.id,
          displayName: model.name,
          local: false,
          capabilities: ["Image Generation", "Cloud"],
        });
      }
    }

    if (videoStatus.data?.connected) {
      for (const model of videoModels.data ?? []) {
        output.push({
          provider: "fal",
          providerName: "fal.ai",
          name: model.id,
          displayName: model.name,
          local: false,
          capabilities: ["Video", "Cloud"],
        });
      }
    }

    const unique = new Map<string, RoleModelOption>();
    for (const model of output) {
      const key = `${modelOptionKey(model)}:${model.serverUrl ?? ""}`;
      if (!unique.has(key)) unique.set(key, model);
    }
    return [...unique.values()];
  }, [
    discoveredServers,
    imageModels?.models,
    isProviderSetup,
    modelsByProvider,
    providers,
    videoModels.data,
    videoStatus.data?.connected,
  ]);

  const automaticallySelectedChatModel =
    settings?.modelRoles?.chat?.auto !== false
      ? selectBestModelForRole(allModels, "chat")
      : undefined;

  useEffect(() => {
    if (
      !settings ||
      providersLoading ||
      modelsLoading ||
      !automaticallySelectedChatModel
    ) {
      return;
    }

    const saved = settings.modelRoles?.chat?.model;
    if (
      saved?.provider === automaticallySelectedChatModel.provider &&
      saved.name === automaticallySelectedChatModel.name
    ) {
      return;
    }

    const model = {
      provider: automaticallySelectedChatModel.provider,
      name: automaticallySelectedChatModel.name,
    };
    void updateSettings({
      modelRoles: {
        ...settings.modelRoles,
        chat: { auto: true, model },
      },
      chatAgentModel: model,
    });
  }, [
    automaticallySelectedChatModel,
    modelsLoading,
    providersLoading,
    settings,
    updateSettings,
  ]);

  if (!settings) return null;

  const updateRole = (
    role: ModelRole,
    assignment: ModelRoleAssignment,
    selected: RoleModelOption,
  ) => {
    const model = { provider: selected.provider, name: selected.name };
    void updateSettings({
      modelRoles: {
        ...settings.modelRoles,
        [role]: assignment,
      },
      ...legacyPatchForRole(role, model),
    });
  };

  const approveServer = (server: DiscoveredLocalModelServer) => {
    void updateSettings({
      providerSettings: {
        ...settings.providerSettings,
        [server.provider]: {
          ...settings.providerSettings[server.provider],
          apiBaseUrl: server.url,
        },
      },
    });
    showSuccess(
      `${server.name} approved. Save Model Roles to keep this server.`,
    );
  };

  return (
    <div id={SECTION_IDS.modelRoles} className="scroll-mt-24">
      <div className="mb-5 flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300 shadow-[0_0_16px_rgba(0,229,255,0.1)]">
          <Sparkles className="size-5" />
        </span>
        <div>
          <h2 className="font-jarvis-display text-xl font-semibold tracking-wide text-cyan-50">
            Model Roles
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-cyan-100/45">
            Give each job the right model. Models from connected cloud and local
            providers are offered.
          </p>
          {(providersLoading || modelsLoading) && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-cyan-200/45">
              <Loader2 className="size-3 animate-spin" />
              Checking connected providers and model capabilities…
            </p>
          )}
        </div>
      </div>

      <Accordion className="gap-3">
        {MODEL_ROLES.map((role) => (
          <RoleCard
            key={role}
            role={role}
            models={allModels}
            assignment={settings.modelRoles?.[role]}
            legacyModel={legacyModelForRole(role, settings)}
            onChange={(assignment, model) =>
              updateRole(role, assignment, model)
            }
          />
        ))}
        <LocalDiscovery
          servers={discoveredServers}
          onServers={setDiscoveredServers}
          onApprove={approveServer}
          savedTargets={savedLocalTargets}
        />
      </Accordion>

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-cyan-500/10 bg-cyan-500/4 px-4 py-3 text-xs text-cyan-100/40">
        <Server className="mt-0.5 size-4 shrink-0" />
        Local discovery runs only when you request it. Automatic subnet
        discovery is limited to private IPv4 addresses and the standard Ollama
        and LM Studio ports.
      </div>
    </div>
  );
}
