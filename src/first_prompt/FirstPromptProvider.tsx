import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { useTranslation } from "react-i18next";
import { usePostHog } from "posthog-js/react";
import { ipc } from "@/ipc/types";
import { generateCuteAppName } from "@/lib/utils";
import { NEON_TEMPLATE_IDS } from "@/shared/templates";
import { neonTemplateHook } from "@/client_logic/template_hook";
import { useSettings } from "@/hooks/useSettings";
import { useLoadApps } from "@/hooks/useLoadApps";
import { invalidateAppQuery } from "@/hooks/useLoadApp";
import { useSelectChat } from "@/hooks/useSelectChat";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useOpenPreviewIfSetupRequired } from "@/hooks/useOpenPreviewIfSetupRequired";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import {
  attachmentsAtom,
  homeChatInputValueAtom,
  homeSelectedAppAtom,
} from "@/atoms/chatAtoms";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import type { Clock } from "@/state_machines/clock";
import { createTraceObserver } from "@/state_machines/trace";
import {
  useControllerSnapshot,
  useManagerLifecycle,
} from "@/state_machines/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SetupBanner } from "@/components/SetupBanner";
import {
  createFirstPromptCommandRunner,
  type FirstPromptDeps,
} from "./commands";
import { FirstPromptController } from "./controller";
import {
  firstPromptSagaProjectionWriteAtom,
  IDLE_FIRST_PROMPT_PROJECTION,
  projectFirstPromptState,
} from "./projection";
import type { FirstPromptEvent, FirstPromptPayload } from "./state";

export interface FirstPromptChatStream {
  submit(request: {
    prompt: string;
    chatId: number;
    appId: number;
    attachments: FirstPromptPayload["attachments"];
    requestedChatMode?: FirstPromptPayload["chatMode"];
  }): void;
}

const FirstPromptContext = createContext<FirstPromptController | null>(null);

export function FirstPromptProvider({
  children,
  chatStream,
  clock,
  settleDelayMs,
}: {
  children: ReactNode;
  chatStream: FirstPromptChatStream;
  clock: Clock;
  settleDelayMs: number;
}) {
  const store = useStore();
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (routerState) => routerState.location.pathname,
  });
  const queryClient = useQueryClient();
  const { t } = useTranslation("home");
  const posthog = usePostHog();
  const { settings } = useSettings();
  const { refreshApps } = useLoadApps();
  const { selectChat } = useSelectChat();
  const openPreviewIfSetupRequired = useOpenPreviewIfSetupRequired();
  const { isAnyProviderSetup, isLoading: providersLoading } =
    useLanguageModelProviders();
  const [isSetupDialogOpen, setIsSetupDialogOpen] = useState(false);
  const previousPathnameRef = useRef(pathname);
  const awaitingStartedWithProviderRef = useRef<boolean | null>(null);
  const settleDelayMsRef = useRef(settleDelayMs);
  settleDelayMsRef.current = settleDelayMs;

  const dependencies = useRef<FirstPromptDeps | null>(null);
  dependencies.current = {
    async createApp(chatMode) {
      const result = await ipc.app.createApp({
        name: generateCuteAppName(),
        initialChatMode: chatMode,
      });
      return {
        appId: result.app.id,
        appName: result.app.name,
        chatId: result.chatId,
      };
    },
    createChat: (appId, chatMode) =>
      ipc.chat.createChat({ appId, initialChatMode: chatMode }),
    async runNeonTemplateHook(appId, appName) {
      if (
        settings?.selectedTemplateId &&
        NEON_TEMPLATE_IDS.has(settings.selectedTemplateId)
      ) {
        await neonTemplateHook({ appId, appName });
      }
    },
    async applyTheme(appId) {
      if (settings?.selectedThemeId) {
        await ipc.template.setAppTheme({
          appId,
          themeId: settings.selectedThemeId,
        });
      }
    },
    async openPreviewIfSetupRequired(appId) {
      const opened = await openPreviewIfSetupRequired(appId);
      if (!opened) store.set(isPreviewOpenAtom, false);
      return opened;
    },
    submitPrompt({ appId, chatId, payload }) {
      chatStream.submit({
        prompt: payload.prompt,
        chatId,
        appId,
        attachments: payload.attachments,
        requestedChatMode: payload.chatMode,
      });
      posthog.capture("home:chat-submit", {
        existingApp: payload.selectedApp !== undefined,
      });
      posthog.capture("chat:home_submit", {
        chatMode: payload.chatMode,
        existingApp: payload.selectedApp !== undefined,
      });
    },
    async refreshQueries(appId) {
      await refreshApps();
      await invalidateAppQuery(queryClient, { appId });
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
    },
    navigateHome() {
      setIsSetupDialogOpen(false);
      void navigate({ to: "/", search: {}, replace: true });
    },
    selectChat(appId, chatId) {
      selectChat({ appId, chatId });
    },
    showSetupDialog() {
      posthog.capture("home:ai-setup-dialog-open");
      setIsSetupDialogOpen(true);
    },
    clearEditingBuffer() {
      store.set(homeChatInputValueAtom, "");
      store.set(attachmentsAtom, []);
      store.set(homeSelectedAppAtom, null);
    },
    showError(message, failure) {
      const key =
        failure === "createChat"
          ? "failedCreateChat"
          : failure === "postCreate"
            ? "failedFinishSetup"
            : "failedCreateApp";
      showError(t(key, { error: message }));
    },
  };

  const [controller] = useState(
    () =>
      new FirstPromptController({
        runner: createFirstPromptCommandRunner({
          clock,
          getSettleDelayMs: () => settleDelayMsRef.current,
          getDeps: () => {
            const current = dependencies.current;
            if (!current) {
              throw new Error("First prompt dependencies are not initialised");
            }
            return current;
          },
        }),
        observer: createTraceObserver("first_prompt"),
        onDispose: () =>
          store.set(
            firstPromptSagaProjectionWriteAtom,
            IDLE_FIRST_PROMPT_PROJECTION,
          ),
      }),
  );
  useManagerLifecycle(controller);
  const snapshot = useControllerSnapshot(controller);

  useEffect(() => {
    const project = () =>
      store.set(
        firstPromptSagaProjectionWriteAtom,
        projectFirstPromptState(controller.getSnapshot()),
      );
    project();
    return controller.subscribe(project);
  }, [controller, store]);

  useEffect(() => {
    if (snapshot.type !== "checkingProviders") return;
    const anySetup = isAnyProviderSetup();
    if (providersLoading && !anySetup) return;
    controller.send({ type: "PROVIDERS_LOADED", anySetup });
  }, [controller, isAnyProviderSetup, providersLoading, snapshot.type]);

  const hasConfiguredProvider = isAnyProviderSetup();
  useEffect(() => {
    if (snapshot.type !== "awaitingProviderSetup") {
      awaitingStartedWithProviderRef.current = null;
      return;
    }
    if (awaitingStartedWithProviderRef.current === null) {
      awaitingStartedWithProviderRef.current = hasConfiguredProvider;
      return;
    }
    if (
      pathname !== "/" &&
      !awaitingStartedWithProviderRef.current &&
      hasConfiguredProvider
    ) {
      controller.send({ type: "PROVIDER_CONFIGURED" });
    }
  }, [controller, hasConfiguredProvider, pathname, snapshot.type]);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;
    if (pathname !== "/") {
      setIsSetupDialogOpen(false);
    } else if (
      previousPathname !== "/" &&
      controller.getSnapshot().type === "awaitingProviderSetup"
    ) {
      controller.send({ type: "SETUP_DISMISSED" });
    }
  }, [controller, pathname]);

  return (
    <FirstPromptContext.Provider value={controller}>
      {children}
      <Dialog
        open={isSetupDialogOpen}
        onOpenChange={(open) => {
          setIsSetupDialogOpen(open);
          if (!open) controller.send({ type: "SETUP_DISMISSED" });
        }}
      >
        <DialogContent className="p-0 sm:max-w-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>
              {hasConfiguredProvider
                ? "Manage AI setup"
                : "You're almost ready to build"}
            </DialogTitle>
            <DialogDescription>
              {hasConfiguredProvider
                ? "Change how Dyad accesses AI."
                : "Choose how Dyad should access AI before generating your app."}
            </DialogDescription>
          </DialogHeader>
          <SetupBanner variant="dialog" forceShow />
        </DialogContent>
      </Dialog>
    </FirstPromptContext.Provider>
  );
}

export function useFirstPromptController(): FirstPromptController {
  const controller = useContext(FirstPromptContext);
  if (!controller) {
    throw new Error("useFirstPromptController requires FirstPromptProvider");
  }
  return controller;
}

export function useFirstPromptSend(): (event: FirstPromptEvent) => boolean {
  return useFirstPromptController().send;
}
