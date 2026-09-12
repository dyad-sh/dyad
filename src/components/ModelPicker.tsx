import { isDyadProEnabled, type LargeLanguageModel } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useClaudeCodeStatus } from "@/hooks/useClaudeCodeStatus";
import { BackendSwitchDialog } from "@/components/BackendSwitchDialog";
import {
  CLAUDE_CODE_CHARGE_DISCLOSURE,
  ClaudeCodeChargeDialog,
} from "@/components/ClaudeCodeChargeDialog";
import {
  CLAUDE_CODE_EFFORT_SETTINGS,
  CLAUDE_CODE_MODEL_OPTIONS,
  CLAUDE_CODE_PROVIDER_ID,
  getBackendForModel,
  getClaudeCodeModelDisplayName,
  isClaudeCodeModel,
  wouldChangeChatBackend,
  type ClaudeCodeModelOption,
} from "@/shared/chat_backend";
import { showError as showErrorToast } from "@/lib/toast";
import { usePostHog } from "posthog-js/react";
import { useLocalModels } from "@/hooks/useLocalModels";
import { useLocalLMSModels } from "@/hooks/useLMStudioModels";
import { useLanguageModelsByProviders } from "@/hooks/useLanguageModelsByProviders";

import { ipc, type LanguageModel, type LocalModel } from "@/ipc/types";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useSettings } from "@/hooks/useSettings";
import { PriceBadge } from "@/components/PriceBadge";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useTrialModelRestriction } from "@/hooks/useTrialModelRestriction";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CheckIcon,
  ChevronRightIcon,
  LockIcon,
  SparklesIcon,
} from "lucide-react";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { providerSettingsRoute } from "@/routes/settings/providers/$provider";
import { useFreeModelQuota } from "@/hooks/useFreeModelQuota";
import {
  FREE_PRO_MODEL_FALLBACK_CHAT_MODE,
  FREE_PRO_MODEL_NAME,
  isFreeProBuildModeCombination,
  isFreeProLanguageModel,
  isFreeProModel,
} from "@/lib/freeProModel";
import { useRouterState } from "@tanstack/react-router";
import { useChatMode } from "@/hooks/useChatMode";
import {
  createModelSelection,
  formatCompactEffortLevel,
  formatEffortLevel,
  getEffortSettings,
  getModelPreferenceKey,
} from "@/lib/modelEffort";
import {
  addRecentModel,
  getEffectiveRecentModels,
  isSameModel,
} from "@/lib/recentModels";
import {
  AUTO_SIDEKICK_CHAT_MODE,
  AUTO_SIDEKICK_DISPLAY_NAME,
  AUTO_SIDEKICK_MODEL_NAME,
  isAutoSidekickModel,
} from "@/lib/autoSidekick";

const SCROLL_AREA_CLASS = "max-h-100 overflow-y-auto scrollbar-on-hover";

const MODEL_MENU_WIDTH_CLASS = "w-[min(20rem,calc(100vw-1.5rem))]";

const PILL_CLASS =
  "text-[10px] leading-none px-1.5 py-1 rounded-full font-medium";

const PRO_PILL_CLASS = cn(
  PILL_CLASS,
  "bg-gradient-to-r from-indigo-600 via-indigo-500 to-indigo-600 bg-[length:200%_100%] animate-[shimmer_5s_ease-in-out_infinite] text-white",
);

const SECTION_LABEL_CLASS =
  "px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-wider font-medium text-muted-foreground";

const DYAD_PRO_UPGRADE_BASE_URL =
  "https://www.dyad.sh/pro?utm_source=dyad-app&utm_medium=app";

const NAVIGATION_SUBMENU_HOVER_PROPS = {
  openOnHover: true,
  delay: 120,
  closeDelay: 100,
} as const;

type Tier = { label: string; caption: string; min: number; max: number };
type RecentModelEntry =
  | { type: "cloud"; providerId: string; model: LanguageModel }
  | {
      type: "local";
      providerId: "ollama" | "lmstudio";
      model: LocalModel;
    }
  | {
      type: "local-loading";
      providerId: "ollama" | "lmstudio";
      modelName: string;
    };
type ModelSelectParams = {
  model: LargeLanguageModel;
  catalogModel?: LanguageModel | null;
  effortLevel?: string;
  rememberEffort?: boolean;
};
const PRICE_TIERS: Tier[] = [
  {
    label: "Premium",
    caption: "Strongest and most expensive",
    min: 6,
    max: Number.POSITIVE_INFINITY,
  },
  {
    label: "Standard",
    caption: "Balanced quality and cost",
    min: 3,
    max: 5,
  },
  {
    label: "Value",
    caption: "Most cost-efficient",
    min: Number.NEGATIVE_INFINITY,
    max: 2,
  },
];

const isFreeOpenRouterModelName = (apiName: string) =>
  apiName.endsWith(":free") || apiName.endsWith("/free");

const formatModelCount = (count: number) =>
  `${count} model${count === 1 ? "" : "s"}`;

const isEffortChevronTarget = (target: EventTarget) =>
  (target as HTMLElement).closest("[data-effort-chevron]") !== null;

const toRecentModelIdentity = (
  model: LargeLanguageModel,
): LargeLanguageModel => ({
  provider: model.provider,
  name: model.name,
  ...(model.customModelId !== undefined
    ? { customModelId: model.customModelId }
    : {}),
});

function tierFor(dollarSigns: number | undefined): Tier {
  const ds = dollarSigns ?? Number.NEGATIVE_INFINITY;
  return (
    PRICE_TIERS.find((t) => ds >= t.min && ds <= t.max) ??
    PRICE_TIERS[PRICE_TIERS.length - 1]
  );
}

export function ModelPicker() {
  const { settings, updateSettings, loading: settingsLoading } = useSettings();
  const routerState = useRouterState();
  const isChatRoute = routerState.location.pathname === "/chat";
  const chatId = routerState.location.search.id as number | undefined;
  const {
    chat,
    isLoading: chatLoading,
    selectedMode,
    setChatSelection,
  } = useChatMode(isChatRoute ? chatId : null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const posthog = usePostHog();
  const { isTrial, isLoadingTrialStatus } = useTrialModelRestriction();
  const freeModelQuota = useFreeModelQuota();
  const hasEstablishedChat = Boolean(
    chat && (chat.modelSelection || chat.messages.length > 0),
  );
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const [open, setOpen] = useState(false);
  const claudeCode = useClaudeCodeStatus({ enabled: open });
  // Pending selection that would move the current chat to another backend.
  const [backendSwitchTarget, setBackendSwitchTarget] = useState<
    (ModelSelectParams & { label: string }) | null
  >(null);
  const [isStartingNewChat, setIsStartingNewChat] = useState(false);
  // Selection waiting on the first-use Dyad charge acknowledgement.
  const [chargeDialogPending, setChargeDialogPending] = useState<
    (ModelSelectParams & { label: string }) | null
  >(null);
  const performModelSelect = async ({
    model,
    catalogModel,
    effortLevel,
    rememberEffort = false,
    recentModels,
  }: ModelSelectParams & { recentModels: LargeLanguageModel[] }) => {
    if (!settings || (isChatRoute && chatId != null && chatLoading)) return;
    const modelSelection = createModelSelection({
      model,
      catalogModel,
      preferredEffortLevel:
        effortLevel ??
        settings.modelEffortPreferences?.[getModelPreferenceKey(model)],
    });
    posthog.capture("model-picker:select", {
      provider: model.provider,
      model: model.name,
      effortLevel: modelSelection.effortLevel,
    });
    const fallbackChatMode = isAutoSidekickModel(model)
      ? AUTO_SIDEKICK_CHAT_MODE
      : isFreeProBuildModeCombination(model, selectedMode)
        ? FREE_PRO_MODEL_FALLBACK_CHAT_MODE
        : undefined;

    const preferenceUpdate = rememberEffort
      ? {
          modelEffortPreferences: {
            ...settings.modelEffortPreferences,
            [getModelPreferenceKey(model)]: modelSelection.effortLevel,
          },
        }
      : {};
    const recentModelsUpdate =
      model.provider === "auto"
        ? settings.recentModels === undefined && recentModels.length > 0
          ? { recentModels }
          : {}
        : {
            recentModels: addRecentModel(recentModels, model),
          };
    if (hasEstablishedChat && chatId) {
      await setChatSelection({
        modelSelection,
        ...(fallbackChatMode ? { chatMode: fallbackChatMode } : {}),
      });
      if (
        rememberEffort ||
        model.provider !== "auto" ||
        "recentModels" in recentModelsUpdate
      ) {
        await updateSettings({
          ...preferenceUpdate,
          ...recentModelsUpdate,
        });
      }
    } else {
      await updateSettings({
        selectedModel: model,
        ...preferenceUpdate,
        ...recentModelsUpdate,
        ...(fallbackChatMode ? { selectedChatMode: fallbackChatMode } : {}),
        ...(isFreeProModel(model) && settings.defaultChatMode === "build"
          ? { defaultChatMode: FREE_PRO_MODEL_FALLBACK_CHAT_MODE }
          : {}),
      });
    }
    // Invalidate token count when model changes since different models have different context windows
    // (technically they have different tokenizers, but we don't keep track of that).
    queryClient.invalidateQueries({ queryKey: queryKeys.tokenCount.all });
  };

  const [unlockTarget, setUnlockTarget] = useState<{
    providerId: string;
    model: LanguageModel;
  } | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      posthog.capture("model-picker:open", {
        isDyadPro: settings ? isDyadProEnabled(settings) : false,
      });
    }
  };

  // Cloud models from providers
  const {
    data: modelsByProviders,
    isLoading: modelsByProvidersLoading,
    error: modelsByProvidersError,
  } = useLanguageModelsByProviders();

  const {
    data: providers,
    isLoading: providersLoading,
    error: providersError,
    isProviderSetup,
  } = useLanguageModelProviders();

  const loading = modelsByProvidersLoading || providersLoading;
  const dyadProEnabled = settings ? isDyadProEnabled(settings) : false;
  // Ollama Models Hook
  const {
    models: ollamaModels,
    loading: ollamaLoading,
    error: ollamaError,
    loadModels: loadOllamaModels,
  } = useLocalModels();

  // LM Studio Models Hook
  const {
    models: lmStudioModels,
    loading: lmStudioLoading,
    error: lmStudioError,
    loadModels: loadLMStudioModels,
  } = useLocalLMSModels();
  const [localProvidersLoaded, setLocalProvidersLoaded] = useState({
    ollama: false,
    lmstudio: false,
  });

  // Load models when the dropdown opens
  useEffect(() => {
    if (open) {
      let active = true;
      setLocalProvidersLoaded({ ollama: false, lmstudio: false });
      void loadOllamaModels().finally(() => {
        if (active) {
          setLocalProvidersLoaded((loaded) => ({ ...loaded, ollama: true }));
        }
      });
      void loadLMStudioModels().finally(() => {
        if (active) {
          setLocalProvidersLoaded((loaded) => ({
            ...loaded,
            lmstudio: true,
          }));
        }
      });
      return () => {
        active = false;
      };
    }
  }, [open, loadOllamaModels, loadLMStudioModels]);

  // Get display name for the selected model
  const selectedModel: LargeLanguageModel = chat?.modelSelection ??
    settings?.selectedModel ?? {
      provider: "auto",
      name: "auto",
    };

  const getModelDisplayName = () => {
    if (isAutoSidekickModel(selectedModel)) {
      return AUTO_SIDEKICK_DISPLAY_NAME;
    }
    if (isClaudeCodeModel(selectedModel)) {
      return getClaudeCodeModelDisplayName(selectedModel.name);
    }
    if (selectedModel.provider === "ollama") {
      return (
        ollamaModels.find(
          (model: LocalModel) => model.modelName === selectedModel.name,
        )?.displayName || selectedModel.name
      );
    }
    if (selectedModel.provider === "lmstudio") {
      return (
        lmStudioModels.find(
          (model: LocalModel) => model.modelName === selectedModel.name,
        )?.displayName || selectedModel.name // Fallback to path if not found
      );
    }

    // For cloud models, look up in the modelsByProviders data
    if (modelsByProviders && modelsByProviders[selectedModel.provider]) {
      const customFoundModel = modelsByProviders[selectedModel.provider].find(
        (model) =>
          model.type === "custom" && model.id === selectedModel.customModelId,
      );
      if (customFoundModel) {
        return customFoundModel.displayName;
      }
      const foundModel = modelsByProviders[selectedModel.provider].find(
        (model) => model.apiName === selectedModel.name,
      );
      if (foundModel) {
        return foundModel.displayName;
      }
    }

    // Fallback if not found
    return selectedModel.name;
  };

  // Get auto provider models (if any)
  const catalogAutoModels =
    !loading && modelsByProviders && modelsByProviders["auto"]
      ? modelsByProviders["auto"].filter((model) => {
          if (model.apiName === FREE_PRO_MODEL_NAME) {
            return dyadProEnabled && !isTrial && !isLoadingTrialStatus;
          }
          if (settings && !dyadProEnabled && model.apiName === "value") {
            return false;
          }
          if (settings && !dyadProEnabled && model.apiName === "balanced") {
            return false;
          }
          if (settings && dyadProEnabled && model.apiName === "free") {
            return false;
          }
          return true;
        })
      : [];
  const regularAutoModel = catalogAutoModels.find(
    (model) => model.apiName === "auto",
  );
  const autoModels = regularAutoModel
    ? catalogAutoModels.flatMap((model) =>
        model.apiName === "auto" && dyadProEnabled
          ? [
              model,
              {
                ...model,
                apiName: AUTO_SIDEKICK_MODEL_NAME,
                displayName: AUTO_SIDEKICK_DISPLAY_NAME,
                description:
                  "Uses Auto and delegates straightforward implementation tasks to a Sidekick",
                tag: "Experimental",
                tagColor:
                  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
              },
            ]
          : [model],
      )
    : catalogAutoModels;

  if (!settings) {
    return null;
  }
  const selectedCatalogModel = modelsByProviders?.[
    selectedModel.provider
  ]?.find((model) =>
    selectedModel.customModelId !== undefined
      ? model.type === "custom" && model.id === selectedModel.customModelId
      : model.apiName === selectedModel.name,
  );
  const normalizedSelectedModel =
    selectedModel.customModelId === undefined &&
    selectedCatalogModel?.type === "custom" &&
    selectedCatalogModel.id !== undefined
      ? { ...selectedModel, customModelId: selectedCatalogModel.id }
      : selectedModel;
  const selectedEffortLevel = createModelSelection({
    model: selectedModel,
    catalogModel: selectedCatalogModel,
    preferredEffortLevel:
      chat?.modelSelection?.effortLevel ??
      settings.modelEffortPreferences?.[getModelPreferenceKey(selectedModel)],
  }).effortLevel;
  const modelDisplayName = getModelDisplayName();
  const trialAutoModel = autoModels.find((model) => model.apiName === "auto");
  const trialAutoEffortSettings = getEffortSettings(trialAutoModel);
  const trialAutoEffort = createModelSelection({
    model: { name: "auto", provider: "auto" },
    catalogModel: trialAutoModel,
    preferredEffortLevel:
      selectedModel.provider === "auto" && selectedModel.name === "auto"
        ? selectedEffortLevel
        : settings.modelEffortPreferences?.[
            getModelPreferenceKey({ name: "auto", provider: "auto" })
          ],
  }).effortLevel;
  // The root menu is a quick switcher. The complete catalog is prepared here
  // for the nested "All models" menu.
  const providerEntries =
    !loading && modelsByProviders
      ? Object.entries(modelsByProviders).filter(
          ([providerId]) => providerId !== "auto",
        )
      : [];
  const isVisibleCatalogModel = (providerId: string, model: LanguageModel) =>
    !(
      dyadProEnabled &&
      providerId === "openrouter" &&
      isFreeOpenRouterModelName(model.apiName)
    );
  const isOtherProvider = (providerId: string) => {
    const provider = providers?.find(
      (candidate) => candidate.id === providerId,
    );
    return provider?.secondary === true || provider?.type === "custom";
  };
  const primaryModelEntries = providerEntries
    .filter(([providerId]) => !isOtherProvider(providerId))
    .flatMap(([providerId, models], providerIndex) =>
      models.flatMap((model, modelIndex) => {
        if (!isVisibleCatalogModel(providerId, model)) {
          return [];
        }
        return [{ providerId, model, providerIndex, modelIndex }];
      }),
    )
    .sort((a, b) => {
      const aPrice = a.model.dollarSigns ?? Number.NEGATIVE_INFINITY;
      const bPrice = b.model.dollarSigns ?? Number.NEGATIVE_INFINITY;
      if (aPrice !== bPrice) {
        return bPrice - aPrice;
      }
      if (a.providerIndex !== b.providerIndex) {
        return a.providerIndex - b.providerIndex;
      }
      return a.modelIndex - b.modelIndex;
    });
  const otherProviderEntries = providerEntries
    .filter(([providerId]) => isOtherProvider(providerId))
    .map(
      ([providerId, models]) =>
        [
          providerId,
          models.filter((model) => isVisibleCatalogModel(providerId, model)),
        ] as [string, LanguageModel[]],
    )
    .filter(([, models]) => models.length > 0);

  const effectiveRecentModels = getEffectiveRecentModels(
    settings.recentModels,
    toRecentModelIdentity(selectedModel),
  );
  const recentModelEntries = effectiveRecentModels.flatMap<RecentModelEntry>(
    (recentModel) => {
      if (recentModel.provider === "ollama") {
        if (ollamaError) {
          return [];
        }
        const model = ollamaModels.find(
          (candidate) => candidate.modelName === recentModel.name,
        );
        if (model) {
          return [
            { type: "local" as const, providerId: "ollama" as const, model },
          ];
        }
        return localProvidersLoaded.ollama
          ? []
          : [
              {
                type: "local-loading" as const,
                providerId: "ollama" as const,
                modelName: recentModel.name,
              },
            ];
      }
      if (recentModel.provider === "lmstudio") {
        if (lmStudioError) {
          return [];
        }
        const model = lmStudioModels.find(
          (candidate) => candidate.modelName === recentModel.name,
        );
        if (model) {
          return [
            {
              type: "local" as const,
              providerId: "lmstudio" as const,
              model,
            },
          ];
        }
        return localProvidersLoaded.lmstudio
          ? []
          : [
              {
                type: "local-loading" as const,
                providerId: "lmstudio" as const,
                modelName: recentModel.name,
              },
            ];
      }

      const model = modelsByProviders?.[recentModel.provider]?.find(
        (candidate) =>
          isVisibleCatalogModel(recentModel.provider, candidate) &&
          (recentModel.customModelId
            ? candidate.type === "custom" &&
              candidate.id === recentModel.customModelId
            : candidate.apiName === recentModel.name),
      );
      return model
        ? [
            {
              type: "cloud" as const,
              providerId: recentModel.provider,
              model,
            },
          ]
        : [];
    },
  );
  const recentModelsWithoutStaleEntries = effectiveRecentModels.filter(
    (recentModel) => {
      if (recentModel.provider === "ollama") {
        return (
          Boolean(ollamaError) ||
          !localProvidersLoaded.ollama ||
          ollamaModels.some(
            (candidate) => candidate.modelName === recentModel.name,
          )
        );
      }
      if (recentModel.provider === "lmstudio") {
        return (
          Boolean(lmStudioError) ||
          !localProvidersLoaded.lmstudio ||
          lmStudioModels.some(
            (candidate) => candidate.modelName === recentModel.name,
          )
        );
      }
      if (loading || modelsByProvidersError || providersError) {
        return true;
      }
      if (recentModel.customModelId === undefined) {
        // The successful query can still contain the bundled fallback catalog,
        // which is intentionally smaller than the remote catalog. Keep
        // unresolved built-in identities persisted and merely omit their rows.
        return true;
      }
      return (modelsByProviders?.[recentModel.provider] ?? []).some(
        (candidate) =>
          candidate.type === "custom" &&
          candidate.id === recentModel.customModelId,
      );
    },
  );
  const normalizedRecentModels = recentModelsWithoutStaleEntries.map(
    (recentModel) => {
      if (recentModel.customModelId !== undefined) {
        return recentModel;
      }
      const resolvedModel = modelsByProviders?.[recentModel.provider]?.find(
        (candidate) => candidate.apiName === recentModel.name,
      );
      return resolvedModel?.type === "custom" && resolvedModel.id !== undefined
        ? { ...recentModel, customModelId: resolvedModel.id }
        : recentModel;
    },
  );
  const onModelSelect = (params: ModelSelectParams) =>
    performModelSelect({ ...params, recentModels: normalizedRecentModels });

  /**
   * Route every selection through the backend rule: changing the model
   * inside the current backend applies immediately, while a selection that
   * would move an established chat to a different backend asks the user to
   * start a new chat instead (the current chat is never switched or cleared).
   */
  const selectWithBackendGuard = (
    params: ModelSelectParams & { label: string },
  ) => {
    if (
      hasEstablishedChat &&
      chat &&
      wouldChangeChatBackend(chat, params.model)
    ) {
      setOpen(false);
      setBackendSwitchTarget(params);
      return;
    }
    void onModelSelect(params);
  };

  const selectClaudeCodeModel = (
    option: ClaudeCodeModelOption,
    effortLevel?: string,
  ) => {
    const params: ModelSelectParams & { label: string } = {
      model: { provider: CLAUDE_CODE_PROVIDER_ID, name: option.name },
      catalogModel: {
        apiName: option.name,
        displayName: option.displayName,
        description: option.description,
        effortSettings: {
          defaultEffortLevel: CLAUDE_CODE_EFFORT_SETTINGS.defaultEffortLevel,
          possibleEffortLevels: [
            ...CLAUDE_CODE_EFFORT_SETTINGS.possibleEffortLevels,
          ],
        },
        type: "cloud",
      },
      effortLevel,
      rememberEffort: effortLevel !== undefined,
      label: `Claude Code (${option.displayName})`,
    };
    setOpen(false);
    if (!claudeCode.status?.chargeAcknowledged) {
      // Explain the separate Dyad charge before the first subscription use.
      setChargeDialogPending(params);
      return;
    }
    selectWithBackendGuard(params);
  };

  const acknowledgeChargeAndContinue = async () => {
    const pending = chargeDialogPending;
    if (!pending) return;
    try {
      await claudeCode.acknowledgeCharge();
      posthog.capture("claude-code:charge-acknowledged");
      setChargeDialogPending(null);
      selectWithBackendGuard(pending);
    } catch (error) {
      showErrorToast(
        `Could not save the acknowledgement: ${(error as Error).message}`,
      );
    }
  };

  const startNewChatWithBackend = async () => {
    const target = backendSwitchTarget;
    if (!target || !chat || !settings) return;
    setIsStartingNewChat(true);
    try {
      const modelSelection = createModelSelection({
        model: target.model,
        catalogModel: target.catalogModel,
        preferredEffortLevel:
          target.effortLevel ??
          settings.modelEffortPreferences?.[
            getModelPreferenceKey(target.model)
          ],
      });
      const newChatId = await ipc.chat.createChat({ appId: chat.appId });
      await ipc.chat.updateChat({
        chatId: newChatId,
        modelSelection,
        executionBackend: getBackendForModel(target.model),
      });
      await updateSettings({
        selectedModel: target.model,
        ...(target.model.provider === "auto"
          ? {}
          : {
              recentModels: addRecentModel(
                normalizedRecentModels,
                target.model,
              ),
            }),
      });
      posthog.capture("model-picker:backend-switch-new-chat", {
        backend: getBackendForModel(target.model),
        provider: target.model.provider,
        model: target.model.name,
      });
      setBackendSwitchTarget(null);
      setSelectedChatId(newChatId);
      navigate({ to: "/chat", search: { id: newChatId } });
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.tokenCount.all });
    } catch (error) {
      showErrorToast(`Failed to start a new chat: ${(error as Error).message}`);
    } finally {
      setIsStartingNewChat(false);
    }
  };

  const getProviderDisplayName = (providerId: string) => {
    const provider = providers?.find((p) => p.id === providerId);
    return provider?.name ?? providerId;
  };

  // Non-Pro users can still use any cloud model with their own API key, so a
  // model is only locked when neither Dyad Pro nor a provider key can run it.
  // Custom and local providers are never locked: Pro doesn't unlock those.
  // While settings/env vars are still loading we can't tell whether a key
  // exists, so fail open rather than flash a lock at env-var-configured users.
  const isModelLocked = (providerId: string) => {
    if (settingsLoading || dyadProEnabled || providerId === "auto") {
      return false;
    }
    const provider = providers?.find((p) => p.id === providerId);
    return provider?.type === "cloud" && !isProviderSetup(providerId);
  };

  const handleLockedModelClick = (providerId: string, model: LanguageModel) => {
    posthog.capture("model-picker:locked-model-click", {
      provider: providerId,
      model: model.apiName,
    });
    setOpen(false);
    setUnlockTarget({ providerId, model });
  };

  const handleUnlockAllClick = () => {
    posthog.capture("model-picker:upgrade-click", {
      source: "unlock-all-footer",
    });
    ipc.system.openExternalUrl(
      `${DYAD_PRO_UPGRADE_BASE_URL}&utm_campaign=model-picker-unlock-all`,
    );
    setOpen(false);
  };

  const handleUnlockDialogUpgradeClick = () => {
    if (!unlockTarget) {
      return;
    }
    posthog.capture("model-picker:upgrade-click", {
      source: "locked-model-dialog",
      provider: unlockTarget.providerId,
      model: unlockTarget.model.apiName,
    });
    ipc.system.openExternalUrl(
      `${DYAD_PRO_UPGRADE_BASE_URL}&utm_campaign=model-picker-locked-model`,
    );
    setUnlockTarget(null);
  };

  const handleUnlockDialogOwnKeyClick = () => {
    if (!unlockTarget) {
      return;
    }
    posthog.capture("model-picker:add-own-key-click", {
      provider: unlockTarget.providerId,
    });
    const providerId = unlockTarget.providerId;
    setUnlockTarget(null);
    navigate({
      to: providerSettingsRoute.id,
      params: { provider: providerId },
    });
  };

  const unlockTargetIsFreeModel = unlockTarget
    ? isFreeOpenRouterModelName(unlockTarget.model.apiName)
    : false;
  const unlockTargetProviderName = unlockTarget
    ? getProviderDisplayName(unlockTarget.providerId)
    : "";

  const handleCloudModelSelect = (
    providerId: string,
    model: LanguageModel,
    effortLevel?: string,
  ) => {
    if (isModelLocked(providerId)) {
      handleLockedModelClick(providerId, model);
      return;
    }
    if (
      isFreeProLanguageModel(providerId, model.apiName) &&
      freeModelQuota.isQuotaExceeded
    ) {
      return;
    }

    const customModelId = model.type === "custom" ? model.id : undefined;
    setOpen(false);
    selectWithBackendGuard({
      model: {
        name: model.apiName,
        provider: providerId,
        ...(customModelId !== undefined ? { customModelId } : {}),
      },
      catalogModel: model,
      effortLevel,
      rememberEffort: effortLevel !== undefined,
      label: model.displayName,
    });
  };

  const renderCloudModelItem = ({
    providerId,
    model,
    showPrice = true,
  }: {
    providerId: string;
    model: LanguageModel;
    showPrice?: boolean;
  }) => {
    const modelRef = {
      name: model.apiName,
      provider: providerId,
      customModelId: model.type === "custom" ? model.id : undefined,
    };
    const isSelected = isSameModel(normalizedSelectedModel, modelRef);
    const modelKey = `${providerId}-${model.apiName}-${modelRef.customModelId ?? "catalog"}`;
    const isLocked = isModelLocked(providerId);
    const isAutoProviderRow = providerId === "auto";
    const isFreeProRow = isFreeProLanguageModel(providerId, model.apiName);
    const isFreeProviderRow =
      providerId === "openrouter" && isFreeOpenRouterModelName(model.apiName);
    const isAutoOpenRouterFreeRow =
      isAutoProviderRow && model.apiName === "free";
    const shouldShowDataSharingDisclosure =
      isFreeProRow ||
      isFreeProviderRow ||
      isAutoOpenRouterFreeRow ||
      (isAutoProviderRow &&
        model.apiName === "auto" &&
        !dyadProEnabled &&
        isProviderSetup("openrouter"));
    const freeProResetTimeLabel = freeModelQuota.resetTime
      ? new Intl.DateTimeFormat(undefined, {
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        }).format(new Date(freeModelQuota.resetTime))
      : null;
    const freeProQuotaLabel =
      freeModelQuota.isLoading && !freeModelQuota.quotaStatus
        ? "Loading"
        : freeModelQuota.error
          ? "Unavailable"
          : `${freeModelQuota.messagesRemaining}/${freeModelQuota.messagesLimit} left`;
    const effortSettings = getEffortSettings(model);
    const currentEffort = isSelected
      ? selectedEffortLevel
      : createModelSelection({
          model: modelRef,
          catalogModel: model,
          preferredEffortLevel:
            settings.modelEffortPreferences?.[getModelPreferenceKey(modelRef)],
        }).effortLevel;
    const effortLabel = formatEffortLevel(currentEffort);
    const compactEffortLabel = formatCompactEffortLevel(currentEffort);
    const unlockedAriaLabel = [
      model.displayName,
      showPrice && model.dollarSigns != null
        ? model.dollarSigns === 0
          ? "Free"
          : `Price: ${(model.dollarSigns / 2).toFixed(1)}`
        : null,
      model.tag && !isFreeProRow ? model.tag : null,
      isSelected ? "Selected" : null,
      isFreeProRow ? freeProQuotaLabel : null,
      shouldShowDataSharingDisclosure ? "Data sharing" : null,
      `Effort: ${effortLabel}`,
      "Press Enter to select; press Right Arrow to configure effort",
    ]
      .filter(Boolean)
      .join(". ");

    const rowContent = (
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <span className="min-w-0 flex items-center gap-2">
          {!isAutoProviderRow && (
            <ProviderIcon providerId={providerId} apiName={model.apiName} />
          )}
          <span className="min-w-0 flex flex-col items-start">
            <span
              title={model.description ? undefined : model.displayName}
              className={cn(
                "block max-w-full truncate text-[13px] leading-tight",
                isLocked && "text-muted-foreground",
              )}
            >
              {model.displayName}
            </span>
          </span>
        </span>
        <span className="flex min-w-fit items-center gap-1.5">
          {showPrice && <PriceBadge dollarSigns={model.dollarSigns} />}
          {model.tag && !isFreeProRow && (
            <span
              className={cn(
                PILL_CLASS,
                "bg-primary/10 text-primary",
                model.tagColor,
              )}
            >
              {model.tag}
            </span>
          )}
          {isLocked && (
            <LockIcon className="size-3.5 text-muted-foreground shrink-0" />
          )}
          {isSelected && (
            <CheckIcon className="size-3.5 text-primary shrink-0" />
          )}
          {isFreeProRow && (
            <span
              className={cn(
                PILL_CLASS,
                freeModelQuota.isQuotaExceeded
                  ? "bg-destructive/10 text-destructive"
                  : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
              )}
              title={
                freeProResetTimeLabel
                  ? `Resets at ${freeProResetTimeLabel}`
                  : undefined
              }
            >
              {freeProQuotaLabel}
            </span>
          )}
          {shouldShowDataSharingDisclosure && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className={cn(
                      PILL_CLASS,
                      "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                    )}
                  >
                    Data sharing
                  </span>
                }
              />
              <TooltipContent side="right" align="start">
                Data may be shared with the AI provider and used for training
                models.
              </TooltipContent>
            </Tooltip>
          )}
          {!isLocked && (
            <>
              <span
                data-effort-level
                className="text-xs text-muted-foreground"
                title={
                  model.description
                    ? undefined
                    : `Reasoning effort: ${effortLabel}`
                }
              >
                {compactEffortLabel}
              </span>
              <span
                data-effort-chevron
                className="-mr-1 flex size-6 items-center justify-center rounded-sm hover:bg-muted"
                aria-hidden="true"
              >
                <ChevronRightIcon className="size-4" />
              </span>
            </>
          )}
        </span>
      </div>
    );

    const commonProps = {
      "data-model-provider": providerId,
      "data-model-name": model.apiName,
      "data-locked": isLocked || undefined,
      className: cn(
        "relative px-2 py-1.5",
        isFreeProRow &&
          freeModelQuota.isQuotaExceeded &&
          "opacity-60 cursor-default",
        isSelected &&
          "bg-primary/8 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary",
      ),
    };

    const item = isLocked ? (
      <DropdownMenuItem
        key={modelKey}
        {...commonProps}
        aria-label={
          isFreeProviderRow
            ? `${model.displayName} — requires an API key from ${getProviderDisplayName(providerId)}`
            : `${model.displayName} — requires Dyad Pro or an API key from ${getProviderDisplayName(providerId)}`
        }
        onClick={() => handleLockedModelClick(providerId, model)}
      >
        {rowContent}
      </DropdownMenuItem>
    ) : (
      <DropdownMenuSubTrigger
        key={modelKey}
        {...commonProps}
        aria-label={`${unlockedAriaLabel}.`}
        disabled={isFreeProRow && freeModelQuota.isQuotaExceeded}
        hideChevron
        onMouseDown={(event) => {
          if (!isEffortChevronTarget(event.target)) {
            event.preventBaseUIHandler();
          }
        }}
        onClick={(event) => {
          if (!isEffortChevronTarget(event.target)) {
            event.preventBaseUIHandler();
            handleCloudModelSelect(providerId, model);
          }
        }}
      >
        {rowContent}
      </DropdownMenuSubTrigger>
    );

    const itemWithTooltip = model.description ? (
      <Tooltip key={modelKey}>
        <TooltipTrigger render={item} />
        <TooltipContent side="left" align="start">
          <span className="max-w-64">{model.description}</span>
        </TooltipContent>
      </Tooltip>
    ) : (
      item
    );

    if (isLocked) {
      return itemWithTooltip;
    }

    return (
      <DropdownMenuSub key={modelKey}>
        {itemWithTooltip}
        <DropdownMenuSubContent className="w-52">
          <DropdownMenuLabel>Effort</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {effortSettings.possibleEffortLevels.map((effortLevel) => (
            <DropdownMenuItem
              key={effortLevel}
              onClick={() =>
                handleCloudModelSelect(providerId, model, effortLevel)
              }
            >
              <span>{formatEffortLevel(effortLevel)}</span>
              {effortLevel === effortSettings.defaultEffortLevel && (
                <span className="text-xs text-muted-foreground">(default)</span>
              )}
              {effortLevel === currentEffort && (
                <CheckIcon className="ml-auto size-3.5 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  };

  const renderProviderSubmenu = (
    providerId: string,
    models: LanguageModel[],
  ) => {
    const visibleModels = models.filter((model) =>
      isVisibleCatalogModel(providerId, model),
    );
    if (visibleModels.length === 0) {
      return null;
    }
    const provider = providers?.find((p) => p.id === providerId);
    const providerDisplayName = getProviderDisplayName(providerId);
    const providerState =
      provider?.type === "custom"
        ? "Custom provider"
        : provider?.type === "cloud" && !provider.secondary && dyadProEnabled
          ? "Pro"
          : null;

    return (
      <DropdownMenuSub key={providerId}>
        <DropdownMenuSubTrigger
          className="w-full font-normal"
          data-provider-id={providerId}
          aria-label={[
            providerDisplayName,
            providerState,
            formatModelCount(visibleModels.length),
            "Opens submenu",
          ]
            .filter(Boolean)
            .join(". ")}
          {...NAVIGATION_SUBMENU_HOVER_PROPS}
        >
          <div className="flex flex-col items-start w-full">
            <div className="flex items-center gap-2">
              <span>{providerDisplayName}</span>
              {provider?.type === "cloud" &&
                !provider?.secondary &&
                dyadProEnabled && <span className={PRO_PILL_CLASS}>Pro</span>}
              {provider?.type === "custom" && (
                <span className={cn(PILL_CLASS, "bg-amber-500 text-white")}>
                  Custom
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {formatModelCount(visibleModels.length)}
            </span>
          </div>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          className={cn(MODEL_MENU_WIDTH_CLASS, SCROLL_AREA_CLASS)}
          data-testid={`other-provider-models-${providerId}`}
        >
          <DropdownMenuLabel>
            {providerDisplayName + " Models"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {visibleModels.map((model) =>
            renderCloudModelItem({ providerId, model }),
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  };

  const renderLocalModelItem = (
    providerId: "ollama" | "lmstudio",
    model: LocalModel,
  ) => {
    const modelRef = { name: model.modelName, provider: providerId };
    const isSelected =
      selectedModel.provider === providerId &&
      selectedModel.name === model.modelName;
    const effortSettings = getEffortSettings(undefined, providerId);
    const currentEffort = isSelected
      ? selectedEffortLevel
      : createModelSelection({
          model: modelRef,
          preferredEffortLevel:
            settings.modelEffortPreferences?.[getModelPreferenceKey(modelRef)],
        }).effortLevel;
    const effortLabel = formatEffortLevel(currentEffort);
    const compactEffortLabel = formatCompactEffortLevel(currentEffort);
    const selectLocalModel = (effortLevel?: string) => {
      setOpen(false);
      selectWithBackendGuard({
        model: modelRef,
        effortLevel,
        rememberEffort: effortLevel !== undefined,
        label: model.displayName,
      });
    };

    return (
      <DropdownMenuSub key={`${providerId}-${model.modelName}`}>
        <DropdownMenuSubTrigger
          hideChevron
          aria-label={`${model.displayName}. Effort: ${effortLabel}. Press Enter to select; press Right Arrow to configure effort.`}
          className={cn(
            "relative py-1.5 w-full",
            isSelected &&
              "bg-primary/8 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary",
          )}
          onMouseDown={(event) => {
            if (!isEffortChevronTarget(event.target)) {
              event.preventBaseUIHandler();
            }
          }}
          onClick={(event) => {
            if (!isEffortChevronTarget(event.target)) {
              event.preventBaseUIHandler();
              selectLocalModel();
            }
          }}
        >
          <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <ProviderIcon providerId={providerId} />
              <div className="min-w-0 flex flex-col items-start">
                <span
                  className="block max-w-full truncate text-[13px] leading-tight"
                  title={model.displayName}
                >
                  {model.displayName}
                </span>
                <span
                  className="block max-w-full truncate text-xs text-muted-foreground"
                  title={model.modelName}
                >
                  {model.modelName}
                </span>
              </div>
            </div>
            <div className="flex min-w-fit items-center gap-1.5">
              {isSelected && (
                <CheckIcon className="size-3.5 shrink-0 text-primary" />
              )}
              <span
                data-effort-level
                className="text-xs text-muted-foreground"
                title={`Reasoning effort: ${effortLabel}`}
              >
                {compactEffortLabel}
              </span>
              <span
                data-effort-chevron
                className="-mr-1 flex size-6 items-center justify-center rounded-sm hover:bg-muted"
                aria-hidden="true"
              >
                <ChevronRightIcon className="size-4" />
              </span>
            </div>
          </div>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-52">
          <DropdownMenuLabel>Effort</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {effortSettings.possibleEffortLevels.map((effortLevel) => (
            <DropdownMenuItem
              key={effortLevel}
              onClick={() => selectLocalModel(effortLevel)}
            >
              <span>{formatEffortLevel(effortLevel)}</span>
              {effortLevel === effortSettings.defaultEffortLevel && (
                <span className="text-xs text-muted-foreground">(default)</span>
              )}
              {effortLevel === currentEffort && (
                <CheckIcon className="ml-auto size-3.5 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  };

  const renderLocalProviderSubmenu = ({
    providerId,
    label,
    models,
    loading: localLoading,
    error,
  }: {
    providerId: "ollama" | "lmstudio";
    label: string;
    models: LocalModel[];
    loading: boolean;
    error: Error | null;
  }) => {
    const hasModels = !localLoading && !error && models.length > 0;
    const statusLabel = localLoading
      ? "Loading"
      : error
        ? "Error loading"
        : hasModels
          ? formatModelCount(models.length)
          : "None available";

    return (
      <DropdownMenuSub key={providerId}>
        <DropdownMenuSubTrigger
          disabled={localLoading && models.length === 0}
          className="w-full font-normal"
          aria-label={`${label}. ${statusLabel}. Opens submenu`}
          {...NAVIGATION_SUBMENU_HOVER_PROPS}
        >
          <div className="flex flex-col items-start">
            <span>{label}</span>
            {localLoading ? (
              <span className="text-xs text-muted-foreground">Loading...</span>
            ) : error ? (
              <span className="text-xs text-red-500">Error loading</span>
            ) : !hasModels ? (
              <span className="text-xs text-muted-foreground">
                None available
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {formatModelCount(models.length)}
              </span>
            )}
          </div>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          className={cn(MODEL_MENU_WIDTH_CLASS, SCROLL_AREA_CLASS)}
        >
          <DropdownMenuLabel>{label} Models</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {localLoading && models.length === 0 ? (
            <div className="text-xs text-center py-2 text-muted-foreground">
              Loading models...
            </div>
          ) : error ? (
            <div className="px-2 py-1.5 text-sm text-red-600">
              <div className="flex flex-col">
                <span>Error loading models</span>
                <span className="text-xs text-muted-foreground">
                  {providerId === "ollama"
                    ? "Is Ollama running?"
                    : error.message}
                </span>
              </div>
            </div>
          ) : !hasModels ? (
            <div className="px-2 py-1.5 text-sm">
              <div className="flex flex-col">
                <span>No local models found</span>
                <span className="text-xs text-muted-foreground">
                  {providerId === "ollama"
                    ? "Ensure Ollama is running and models are pulled."
                    : "Ensure LM Studio is running and models are loaded."}
                </span>
              </div>
            </div>
          ) : (
            models.map((model) => renderLocalModelItem(providerId, model))
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  };

  const claudeCodeStatus = claudeCode.status;
  const claudeCodeReady = claudeCodeStatus?.ready === true;
  const claudeCodeStatusLabel = claudeCode.isLoading
    ? "Checking"
    : !claudeCodeStatus
      ? "Unknown"
      : claudeCodeStatus.ready
        ? "Connected"
        : !claudeCodeStatus.installed
          ? "Not installed"
          : !claudeCodeStatus.versionSupported
            ? "Update needed"
            : claudeCodeStatus.auth.state === "unauthenticated"
              ? "Sign in required"
              : !claudeCodeStatus.billingReady
                ? "Dyad Pro required"
                : "Setup needed";
  const isClaudeCodeSelected = isClaudeCodeModel(selectedModel);

  const renderClaudeCodeModelItem = (option: ClaudeCodeModelOption) => {
    const modelRef = { provider: CLAUDE_CODE_PROVIDER_ID, name: option.name };
    const isSelected = isSameModel(normalizedSelectedModel, modelRef);
    const currentEffort = isSelected
      ? selectedEffortLevel
      : (settings.modelEffortPreferences?.[getModelPreferenceKey(modelRef)] ??
        CLAUDE_CODE_EFFORT_SETTINGS.defaultEffortLevel);
    const effortLabel = formatEffortLevel(currentEffort);
    const compactEffortLabel = formatCompactEffortLevel(currentEffort);
    const disabled = !claudeCodeReady;
    const modelKey = `claude-code-${option.name}`;
    const commonProps = {
      "data-model-provider": CLAUDE_CODE_PROVIDER_ID,
      "data-model-name": option.name,
      "data-locked": disabled || undefined,
      className: cn(
        "relative px-2 py-1.5",
        disabled && "opacity-60",
        isSelected &&
          "bg-primary/8 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary",
      ),
    };
    const rowContent = (
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <span className="min-w-0 flex items-center gap-2">
          <ProviderIcon providerId="anthropic" apiName={option.name} />
          <span className="min-w-0 flex flex-col items-start">
            <span className="block max-w-full truncate text-[13px] leading-tight">
              {option.displayName}
            </span>
            <span className="block max-w-full truncate text-xs text-muted-foreground">
              {option.description}
            </span>
          </span>
        </span>
        <span className="flex min-w-fit items-center gap-1.5">
          {isSelected && (
            <CheckIcon className="size-3.5 text-primary shrink-0" />
          )}
          {!disabled && (
            <>
              <span
                data-effort-level
                className="text-xs text-muted-foreground"
                title={`Reasoning effort: ${effortLabel}`}
              >
                {compactEffortLabel}
              </span>
              <span
                data-effort-chevron
                className="-mr-1 flex size-6 items-center justify-center rounded-sm hover:bg-muted"
                aria-hidden="true"
              >
                <ChevronRightIcon className="size-4" />
              </span>
            </>
          )}
        </span>
      </div>
    );
    if (disabled) {
      return (
        <DropdownMenuItem
          key={modelKey}
          {...commonProps}
          disabled
          aria-label={`${option.displayName}. Unavailable: ${claudeCodeStatusLabel}`}
        >
          {rowContent}
        </DropdownMenuItem>
      );
    }
    return (
      <DropdownMenuSub key={modelKey}>
        <DropdownMenuSubTrigger
          {...commonProps}
          hideChevron
          aria-label={`${option.displayName}. Claude Code subscription. ${
            isSelected ? "Selected. " : ""
          }Effort: ${effortLabel}. Press Enter to select; press Right Arrow to configure effort.`}
          onMouseDown={(event) => {
            if (!isEffortChevronTarget(event.target)) {
              event.preventBaseUIHandler();
            }
          }}
          onClick={(event) => {
            if (!isEffortChevronTarget(event.target)) {
              event.preventBaseUIHandler();
              selectClaudeCodeModel(option);
            }
          }}
        >
          {rowContent}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-52">
          <DropdownMenuLabel>Effort</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {CLAUDE_CODE_EFFORT_SETTINGS.possibleEffortLevels.map(
            (effortLevel) => (
              <DropdownMenuItem
                key={effortLevel}
                onClick={() => selectClaudeCodeModel(option, effortLevel)}
              >
                <span>{formatEffortLevel(effortLevel)}</span>
                {effortLevel ===
                  CLAUDE_CODE_EFFORT_SETTINGS.defaultEffortLevel && (
                  <span className="text-xs text-muted-foreground">
                    (default)
                  </span>
                )}
                {effortLevel === currentEffort && (
                  <CheckIcon className="ml-auto size-3.5 text-primary" />
                )}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  };

  const renderClaudeCodeSubmenu = () => (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        className="w-full font-normal"
        data-testid="claude-code-submenu-trigger"
        data-provider-id={CLAUDE_CODE_PROVIDER_ID}
        aria-label={`Claude Code. ${claudeCodeStatusLabel}. ${
          isClaudeCodeSelected ? "Selected. " : ""
        }Opens submenu`}
        {...NAVIGATION_SUBMENU_HOVER_PROPS}
      >
        <div className="flex flex-col items-start w-full">
          <div className="flex items-center gap-2">
            <ProviderIcon providerId="anthropic" />
            <span>Claude Code</span>
            <span
              className={cn(
                PILL_CLASS,
                claudeCodeReady
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
              )}
              data-testid="claude-code-status-pill"
            >
              {claudeCodeStatusLabel}
            </span>
            {isClaudeCodeSelected && (
              <CheckIcon className="size-3.5 text-primary shrink-0" />
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            Your Claude subscription + a separate Dyad charge
          </span>
        </div>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className={cn(MODEL_MENU_WIDTH_CLASS, SCROLL_AREA_CLASS)}
        data-testid="claude-code-models-submenu"
      >
        <DropdownMenuLabel>Claude Code (Subscription)</DropdownMenuLabel>
        <div className="px-2 pb-1.5 text-[11px] text-muted-foreground">
          {CLAUDE_CODE_CHARGE_DISCLOSURE}
        </div>
        {claudeCodeStatus && !claudeCodeStatus.ready && (
          <div
            className="mx-2 mb-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-200"
            data-testid="claude-code-setup-guidance"
          >
            <div className="font-medium">{claudeCodeStatusLabel}</div>
            <div>{claudeCodeStatus.setupGuidance}</div>
          </div>
        )}
        {claudeCode.isLoading && !claudeCodeStatus && (
          <div className="text-xs text-center py-2 text-muted-foreground">
            Checking Claude Code...
          </div>
        )}
        <DropdownMenuSeparator />
        {CLAUDE_CODE_MODEL_OPTIONS.map((option) =>
          renderClaudeCodeModelItem(option),
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="claude-code-refresh-status"
          onClick={(event) => {
            event.preventBaseUIHandler?.();
            void claudeCode.refresh();
          }}
        >
          <span className="text-xs">Re-check status</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="claude-code-open-settings"
          onClick={() => {
            setOpen(false);
            navigate({ to: "/settings" });
          }}
        >
          <span className="text-xs">Claude Code settings and usage</span>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );

  // API-key section: every configured provider (user key or env var), plus
  // custom providers. Dyad Pro routes are listed under Pro credits instead.
  const apiKeyProviderEntries = providerEntries.filter(([providerId]) => {
    const provider = providers?.find(
      (candidate) => candidate.id === providerId,
    );
    if (!provider || provider.type === "local") return false;
    return isProviderSetup(providerId);
  });

  const cloudCatalogGroups = PRICE_TIERS.map((tier) => ({
    tier,
    entries: primaryModelEntries
      .filter((entry) => tierFor(entry.model.dollarSigns) === tier)
      .sort(
        (a, b) =>
          (a.providerId === "openai" ? 0 : 1) -
          (b.providerId === "openai" ? 0 : 1),
      ),
  })).filter((group) => group.entries.length > 0);
  const hasCloudCatalogEntries =
    cloudCatalogGroups.length > 0 || otherProviderEntries.length > 0;
  const cloudCatalogError = modelsByProvidersError ?? providersError;

  return (
    <>
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          disabled={isChatRoute && chatId != null && chatLoading}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border-none bg-transparent shadow-none text-foreground/80 hover:text-foreground hover:bg-muted/60 h-7 max-w-[220px] px-2 gap-1.5 cursor-pointer"
          data-testid="model-picker"
          title={modelDisplayName}
        >
          <span className="truncate">
            {getModelDisplayName() === "Auto" && (
              <>
                <span className="text-xs text-muted-foreground/70">
                  Model:
                </span>{" "}
              </>
            )}
            {modelDisplayName}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent className={MODEL_MENU_WIDTH_CLASS} align="start">
          {/* Trial user upgrade banner */}
          {isTrial && (
            <>
              <div className="px-2 py-3 bg-gradient-to-r from-indigo-50 to-sky-50 dark:from-indigo-950/50 dark:to-sky-950/50">
                <p className="text-sm text-indigo-700 dark:text-indigo-300 mb-2">
                  Upgrade from Dyad Pro trial to unlock more models.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="cursor-pointer w-full bg-indigo-600 hover:bg-indigo-700 text-white hover:text-white border-indigo-600"
                  onClick={() => {
                    ipc.system.openExternalUrl(
                      "https://academy.dyad.sh/subscription",
                    );
                    setOpen(false);
                  }}
                >
                  Upgrade to Dyad Pro
                </Button>
              </div>
              <DropdownMenuSeparator />
              {/* Trial users only see the auto model */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  hideChevron
                  data-model-provider="auto"
                  data-model-name="auto"
                  aria-label={`Auto. Trial. Selected. Effort: ${formatEffortLevel(trialAutoEffort)}. Press Enter to select; press Right Arrow to configure effort.`}
                  className="relative py-2 bg-primary/8 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary"
                  onMouseDown={(event) => {
                    if (!isEffortChevronTarget(event.target)) {
                      event.preventBaseUIHandler();
                    }
                  }}
                  onClick={(event) => {
                    if (!isEffortChevronTarget(event.target)) {
                      event.preventBaseUIHandler();
                      setOpen(false);
                      selectWithBackendGuard({
                        model: { name: "auto", provider: "auto" },
                        catalogModel: autoModels.find(
                          (model) => model.apiName === "auto",
                        ),
                        label: "Auto",
                      });
                    }
                  }}
                >
                  <div className="flex justify-between items-center w-full gap-2">
                    <span className="text-[13px]">Auto</span>
                    <span className="ml-auto flex items-center gap-1.5">
                      <span
                        className={cn(PILL_CLASS, "bg-primary/10 text-primary")}
                      >
                        Trial
                      </span>
                      <CheckIcon className="size-3.5 text-primary shrink-0" />
                      <span
                        data-effort-level
                        className="text-xs text-muted-foreground"
                        title={`Reasoning effort: ${formatEffortLevel(trialAutoEffort)}`}
                      >
                        {formatCompactEffortLevel(trialAutoEffort)}
                      </span>
                      <span
                        data-effort-chevron
                        aria-hidden="true"
                        className="-mr-1 flex size-6 items-center justify-center rounded-sm hover:bg-muted"
                      >
                        <ChevronRightIcon className="size-4" />
                      </span>
                    </span>
                  </div>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  <DropdownMenuLabel>Effort</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {trialAutoEffortSettings.possibleEffortLevels.map(
                    (effortLevel) => (
                      <DropdownMenuItem
                        key={effortLevel}
                        onClick={() => {
                          setOpen(false);
                          selectWithBackendGuard({
                            model: { name: "auto", provider: "auto" },
                            catalogModel: trialAutoModel,
                            effortLevel,
                            rememberEffort: true,
                            label: "Auto",
                          });
                        }}
                      >
                        <span>{formatEffortLevel(effortLevel)}</span>
                        {effortLevel ===
                          trialAutoEffortSettings.defaultEffortLevel && (
                          <span className="text-xs text-muted-foreground">
                            (default)
                          </span>
                        )}
                        {effortLevel === trialAutoEffort && (
                          <CheckIcon className="ml-auto size-3.5 text-primary" />
                        )}
                      </DropdownMenuItem>
                    ),
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}

          {/* Non-trial users get a compact quick switcher grouped by how
              execution is paid for: Subscription, Pro credits, API key. */}
          {!isTrial && (
            <>
              <div
                className={SECTION_LABEL_CLASS}
                data-testid="section-subscription"
              >
                Subscription
              </div>
              {renderClaudeCodeSubmenu()}
              <DropdownMenuSeparator />
              <div
                className={SECTION_LABEL_CLASS}
                data-testid="section-pro-credits"
              >
                Pro credits
              </div>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  className="w-full font-normal"
                  {...NAVIGATION_SUBMENU_HOVER_PROPS}
                >
                  <span>All models</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  className={cn(MODEL_MENU_WIDTH_CLASS, SCROLL_AREA_CLASS)}
                  data-testid="more-models-submenu"
                  data-catalog-loading={loading}
                >
                  <DropdownMenuLabel>All models</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {loading ? (
                    <div className="text-xs text-center py-2 text-muted-foreground">
                      Loading cloud models...
                    </div>
                  ) : !hasCloudCatalogEntries ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      {cloudCatalogError
                        ? "Couldn’t load cloud models"
                        : "No cloud models available"}
                    </div>
                  ) : (
                    <>
                      {(() => {
                        const nodes: ReactNode[] = [];
                        cloudCatalogGroups.forEach(
                          ({ tier, entries }, index) => {
                            if (index > 0) {
                              nodes.push(
                                <DropdownMenuSeparator
                                  key={`tier-sep-${tier.label}`}
                                />,
                              );
                            }
                            nodes.push(
                              <div
                                key={`tier-label-${tier.label}`}
                                className="flex items-center gap-1.5 px-2 pt-1.5 pb-1"
                              >
                                <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground shrink-0">
                                  {tier.label}
                                </span>
                                <span
                                  aria-hidden="true"
                                  className="size-[3px] rounded-full bg-muted-foreground/50 shrink-0"
                                />
                                <span className="text-[11px] text-muted-foreground/85 truncate">
                                  {tier.caption}
                                </span>
                              </div>,
                            );
                            entries.forEach(({ providerId, model }) => {
                              nodes.push(
                                renderCloudModelItem({ providerId, model }),
                              );
                            });
                          },
                        );
                        return nodes;
                      })()}
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <div
                    className="px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-wider font-medium text-muted-foreground"
                    data-testid="local-providers-section"
                  >
                    Local providers
                  </div>
                  {renderLocalProviderSubmenu({
                    providerId: "ollama",
                    label: "Ollama",
                    models: ollamaModels,
                    loading: ollamaLoading,
                    error: ollamaError,
                  })}
                  {renderLocalProviderSubmenu({
                    providerId: "lmstudio",
                    label: "LM Studio",
                    models: lmStudioModels,
                    loading: lmStudioLoading,
                    error: lmStudioError,
                  })}
                  {otherProviderEntries.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <div
                        className="px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-wider font-medium text-muted-foreground"
                        data-testid="cloud-providers-section"
                      >
                        Cloud providers
                      </div>
                      {otherProviderEntries.map(([providerId, models]) =>
                        renderProviderSubmenu(providerId, models),
                      )}
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {loading ? (
                <div className="text-xs text-center py-2 text-muted-foreground">
                  Loading models...
                </div>
              ) : (
                <>
                  {autoModels.length > 0 &&
                    autoModels.map((model) =>
                      renderCloudModelItem({
                        providerId: "auto",
                        model,
                        showPrice: false,
                      }),
                    )}

                  {cloudCatalogError && autoModels.length === 0 && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Couldn’t load cloud models
                    </div>
                  )}

                  <DropdownMenuSeparator />
                  <div
                    className={SECTION_LABEL_CLASS}
                    data-testid="section-api-key"
                  >
                    API key
                  </div>
                  {apiKeyProviderEntries.length > 0 ? (
                    apiKeyProviderEntries.map(([providerId, models]) =>
                      renderProviderSubmenu(providerId, models),
                    )
                  ) : (
                    <DropdownMenuItem
                      data-testid="api-key-add-provider"
                      onClick={() => {
                        setOpen(false);
                        navigate({ to: "/settings" });
                      }}
                    >
                      <span className="text-[13px]">Add an API key…</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        Settings
                      </span>
                    </DropdownMenuItem>
                  )}

                  {recentModelEntries.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Recent
                      </DropdownMenuLabel>
                      {recentModelEntries.map((entry) => {
                        if (entry.type === "cloud") {
                          return renderCloudModelItem({
                            providerId: entry.providerId,
                            model: entry.model,
                          });
                        }
                        if (entry.type === "local") {
                          return renderLocalModelItem(
                            entry.providerId,
                            entry.model,
                          );
                        }
                        return (
                          <DropdownMenuItem
                            key={`${entry.providerId}-${entry.modelName}-loading`}
                            disabled
                            aria-label={`${entry.modelName}. Loading local model`}
                            className="py-1.5"
                          >
                            <ProviderIcon providerId={entry.providerId} />
                            <span className="min-w-0 truncate text-[13px]">
                              {entry.modelName}
                            </span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              Loading...
                            </span>
                          </DropdownMenuItem>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* Upgrade footer for non-Pro users */}
          {!isTrial && !dyadProEnabled && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="model-picker-unlock-all"
                className="px-2 py-2 bg-gradient-to-r from-indigo-50 to-sky-50 dark:from-indigo-950/50 dark:to-sky-950/50 focus:from-indigo-100 focus:to-sky-100 dark:focus:from-indigo-950 dark:focus:to-sky-950"
                onClick={handleUnlockAllClick}
              >
                <div className="flex items-center gap-2 w-full">
                  <SparklesIcon className="size-3.5 text-indigo-600 dark:text-indigo-300 shrink-0" />
                  <span className="text-[13px] font-medium text-indigo-700 dark:text-indigo-300">
                    Unlock all models with Dyad Pro
                  </span>
                </div>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Unlock dialog for locked models */}
      <Dialog
        open={unlockTarget !== null}
        onOpenChange={(dialogOpen) => {
          if (!dialogOpen) {
            setUnlockTarget(null);
          }
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          data-testid="unlock-model-dialog"
        >
          {/* Free models aren't a Pro feature, so don't sell Pro for them —
              they just need the user's own (free) provider API key. */}
          {unlockTargetIsFreeModel ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  Use {unlockTarget?.model.displayName} with your own{" "}
                  {unlockTargetProviderName} API key
                </DialogTitle>
                <DialogDescription>
                  Free models run through your own {unlockTargetProviderName}{" "}
                  account. Add an API key in provider settings to use this
                  model.
                </DialogDescription>
              </DialogHeader>
              <Button
                className="cursor-pointer w-full"
                onClick={handleUnlockDialogOwnKeyClick}
              >
                Add {unlockTargetProviderName} API key
              </Button>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  Unlock {unlockTarget?.model.displayName} with Dyad Pro
                </DialogTitle>
                <DialogDescription>
                  Dyad Pro gives you {unlockTarget?.model.displayName} and every
                  other leading AI model with one subscription — no API keys
                  needed.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <Button
                  className="cursor-pointer w-full"
                  onClick={handleUnlockDialogUpgradeClick}
                >
                  Get Dyad Pro
                </Button>
                <button
                  type="button"
                  className="cursor-pointer text-sm text-primary hover:underline underline-offset-4"
                  onClick={handleUnlockDialogOwnKeyClick}
                >
                  Or use your own {unlockTargetProviderName} API key
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* A selection that would move this chat to another backend. */}
      <BackendSwitchDialog
        open={backendSwitchTarget !== null}
        onOpenChange={(dialogOpen) => {
          if (!dialogOpen && !isStartingNewChat) {
            setBackendSwitchTarget(null);
          }
        }}
        targetLabel={backendSwitchTarget?.label ?? ""}
        onStartNewChat={() => void startNewChatWithBackend()}
        isStarting={isStartingNewChat}
      />

      {/* First-use disclosure of the separate Dyad charge. */}
      <ClaudeCodeChargeDialog
        open={chargeDialogPending !== null}
        onOpenChange={(dialogOpen) => {
          if (!dialogOpen) {
            setChargeDialogPending(null);
          }
        }}
        onAcknowledge={() => void acknowledgeChargeAndContinue()}
      />
    </>
  );
}
