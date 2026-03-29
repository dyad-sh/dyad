import React, { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Check,
  Loader2,
  Palette,
  Layout,
  Paintbrush,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { miniPlanStateAtom } from "@/atoms/miniPlanAtoms";
import {
  selectedChatIdAtom,
  chatMessagesByIdAtom,
  isStreamingByIdAtom,
  chatErrorByIdAtom,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useTemplates } from "@/hooks/useTemplates";
import { useCustomThemes } from "@/hooks/useCustomThemes";
import { useThemes } from "@/hooks/useThemes";
import { useLoadApp } from "@/hooks/useLoadApp";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { MiniPlanUserPrompt } from "./MiniPlanUserPrompt";
import { MiniPlanDesignDirection } from "./MiniPlanDesignDirection";
import { MiniPlanVisuals } from "./MiniPlanVisuals";
import type { CustomTagState } from "./stateTypes";

interface DyadMiniPlanCardProps {
  node: {
    properties: {
      "app-name"?: string;
      appName?: string;
      template?: string;
      theme?: string;
      "design-direction"?: string;
      designDirection?: string;
      "main-color"?: string;
      mainColor?: string;
      complete?: string;
      state?: CustomTagState;
    };
  };
  children?: React.ReactNode;
}

export const DyadMiniPlanCard: React.FC<DyadMiniPlanCardProps> = ({ node }) => {
  const props = node.properties;
  const chatId = useAtomValue(selectedChatIdAtom);
  const isStreamingById = useAtomValue(isStreamingByIdAtom);
  const miniPlanState = useAtomValue(miniPlanStateAtom);
  const setMiniPlanState = useSetAtom(miniPlanStateAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const setIsStreamingById = useSetAtom(isStreamingByIdAtom);
  const setErrorById = useSetAtom(chatErrorByIdAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { app, refreshApp } = useLoadApp(selectedAppId);
  const queryClient = useQueryClient();
  const { templates } = useTemplates();
  const { themes } = useThemes();
  const { customThemes } = useCustomThemes();

  const isApproved = chatId ? miniPlanState.approvedChatIds.has(chatId) : false;
  const planData = chatId ? miniPlanState.plansByChatId.get(chatId) : null;
  const isChatStreaming = chatId
    ? (isStreamingById.get(chatId) ?? false)
    : false;

  // Use atom data if available, fall back to XML attributes
  const appName = planData?.appName || props["app-name"] || props.appName || "";
  const templateId = planData?.templateId || props.template || "react";
  const themeId = planData?.themeId || props.theme || "default";
  const designDirection =
    planData?.designDirection ||
    props["design-direction"] ||
    props.designDirection ||
    "";
  const mainColor =
    planData?.mainColor || props["main-color"] || props.mainColor || "";
  const userPrompt = planData?.userPrompt || "";
  const attachments = planData?.attachments || [];
  const visuals = planData?.visuals || [];
  const allThemeOptions = [
    ...(themes ?? []).map((theme) => ({
      id: theme.id,
      name: theme.name,
      description: theme.description,
      isCustom: false,
    })),
    ...customThemes.map((theme) => ({
      id: `custom:${theme.id}`,
      name: theme.name,
      description: theme.description ?? "",
      isCustom: true,
    })),
  ];

  const isInProgress = props.state === "pending" || props.complete === "false";

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(appName);
  const [isApproving, setIsApproving] = useState(false);

  const handleFieldEdit = useCallback(
    (field: string, value: string) => {
      if (!chatId || isApproved) return;

      // Update local state immediately
      setMiniPlanState((prev) => {
        const nextPlans = new Map(prev.plansByChatId);
        const existing = nextPlans.get(chatId);
        if (existing) {
          nextPlans.set(chatId, { ...existing, [field]: value });
        }
        return { ...prev, plansByChatId: nextPlans };
      });

      // Persist to main process
      ipc.miniPlan.editField({ chatId, field, value });
    },
    [chatId, isApproved, setMiniPlanState],
  );

  const handleApprove = useCallback(async () => {
    if (!chatId || isApproved) return;
    setIsApproving(true);

    // Optimistically mark as approved so UI updates immediately
    setMiniPlanState((prev) => {
      const nextApproved = new Set(prev.approvedChatIds);
      nextApproved.add(chatId);
      return { ...prev, approvedChatIds: nextApproved };
    });

    // Snapshot plan data before the async call
    const plan = miniPlanState.plansByChatId.get(chatId);

    await ipc.miniPlan.approve({ chatId });

    // Apply plan settings to the app
    if (plan && selectedAppId) {
      let currentApp = app;
      let templateApplied = false;

      if (!currentApp) {
        try {
          currentApp = await ipc.app.getApp(selectedAppId);
        } catch (e) {
          console.error("Failed to load app before applying mini plan:", e);
        }
      }

      // Rename the app if the name differs (keep existing folder path)
      if (currentApp && plan.appName && plan.appName !== currentApp.name) {
        try {
          await ipc.app.renameApp({
            appId: selectedAppId,
            appName: plan.appName,
            appPath: currentApp.path,
          });
        } catch (e) {
          console.error("Failed to rename app:", e);
        }
      }

      try {
        const { applied } = await ipc.template.applyAppTemplate({
          appId: selectedAppId,
          templateId: plan.templateId,
          chatId: chatId ?? undefined,
        });
        templateApplied = applied;
      } catch (e) {
        console.error("Failed to apply app template:", e);
      }

      // Set the theme if it differs
      try {
        const currentTheme = await ipc.template.getAppTheme({
          appId: selectedAppId,
        });
        if (plan.themeId !== (currentTheme ?? "default")) {
          await ipc.template.setAppTheme({
            appId: selectedAppId,
            themeId: plan.themeId,
          });
        }
      } catch (e) {
        console.error("Failed to set app theme:", e);
      }

      if (templateApplied) {
        try {
          await ipc.app.restartApp({
            appId: selectedAppId,
            removeNodeModules: true,
          });
        } catch (e) {
          console.error("Failed to restart app after template change:", e);
        }
      }

      // Refresh app data so the sidebar/header reflect the new name
      await Promise.all([
        refreshApp(),
        queryClient.invalidateQueries({ queryKey: queryKeys.apps.all }),
      ]);
    }

    // Build the serialized mini plan context to send to the agent
    if (plan) {
      const visualsSummary =
        plan.visuals.length > 0
          ? plan.visuals
              .map(
                (v) => `- ${v.type}: ${v.description}\n  Prompt: ${v.prompt}`,
              )
              .join("\n")
          : "No visuals planned";

      const templateName =
        templates?.find((t) => t.id === plan.templateId)?.title ??
        plan.templateId;
      const themeName =
        allThemeOptions.find((t) => t.id === plan.themeId)?.name ??
        plan.themeId;

      const miniPlanContext = [
        `[Mini Plan Approved]`,
        `App Name: ${plan.appName}`,
        `Template: ${templateName} (${plan.templateId})`,
        `Theme: ${themeName} (${plan.themeId})`,
        `Main Color: ${plan.mainColor}`,
        `Design Direction: ${plan.designDirection}`,
        ``,
        `Visual Assets:`,
        visualsSummary,
        ``,
        `Original Prompt: ${plan.userPrompt}`,
      ].join("\n");

      // Set streaming state
      setIsStreamingById((prev) => {
        const next = new Map(prev);
        next.set(chatId, true);
        return next;
      });

      // Clear any previous errors
      setErrorById((prev) => {
        const next = new Map(prev);
        next.set(chatId, null);
        return next;
      });

      // Send the approved plan as a follow-up message to start building
      ipc.chatStream.start(
        {
          chatId,
          prompt: miniPlanContext,
          attachments: plan.attachments.map((a) => ({
            name: a.split("/").pop() || a,
            type: "application/octet-stream",
            data: "",
            attachmentType: "chat-context" as const,
          })),
          selectedComponents: [],
        },
        {
          onChunk: ({
            messages: updatedMessages,
            streamingMessageId,
            streamingContent,
          }) => {
            if (updatedMessages) {
              setMessagesById((prev) => {
                const next = new Map(prev);
                next.set(chatId, updatedMessages);
                return next;
              });
            } else if (
              streamingMessageId !== undefined &&
              streamingContent !== undefined
            ) {
              setMessagesById((prev) => {
                const existingMessages = prev.get(chatId);
                if (!existingMessages) return prev;
                const next = new Map(prev);
                const updated = existingMessages.map((msg) =>
                  msg.id === streamingMessageId
                    ? { ...msg, content: streamingContent }
                    : msg,
                );
                next.set(chatId, updated);
                return next;
              });
            }
          },
          onEnd: () => {
            setIsStreamingById((prev) => {
              const next = new Map(prev);
              next.set(chatId, false);
              return next;
            });
          },
          onError: ({ error }) => {
            console.error("Mini plan implementation stream error:", error);
            setErrorById((prev) => {
              const next = new Map(prev);
              next.set(chatId, error);
              return next;
            });
            setIsStreamingById((prev) => {
              const next = new Map(prev);
              next.set(chatId, false);
              return next;
            });
          },
        },
      );
    }

    setIsApproving(false);
  }, [
    chatId,
    isApproved,
    miniPlanState,
    templates,
    themes,
    customThemes,
    selectedAppId,
    app,
    refreshApp,
    queryClient,
    setMiniPlanState,
    setMessagesById,
    setIsStreamingById,
    setErrorById,
  ]);

  const handleNameSubmit = useCallback(() => {
    setEditingName(false);
    if (nameValue.trim() && nameValue !== appName) {
      handleFieldEdit("appName", nameValue.trim());
    } else {
      setNameValue(appName);
    }
  }, [nameValue, appName, handleFieldEdit]);

  return (
    <div
      className={`my-4 border rounded-lg overflow-hidden transition-colors ${
        isInProgress
          ? "border-primary/60"
          : isApproved
            ? "border-emerald-500/30 bg-emerald-50/5"
            : "border-primary/20"
      } bg-card`}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-2">
          <Sparkles
            className={`text-primary ${isInProgress ? "animate-pulse" : ""}`}
            size={18}
          />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Mini Plan
          </span>
        </div>
        {isInProgress && (
          <span className="flex items-center gap-1.5 text-xs text-primary px-3 py-1 bg-primary/10 rounded-md font-medium">
            <Loader2 size={12} className="animate-spin" />
            Generating...
          </span>
        )}
      </div>

      {/* Progress bar during generation */}
      {isInProgress && (
        <div className="px-4 py-1.5">
          <div
            className="h-1 w-full rounded-full overflow-hidden"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, hsl(var(--primary) / 0.3) 50%, transparent 100%)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.5s ease-in-out infinite",
            }}
          />
        </div>
      )}

      {/* Content */}
      <div className="px-4 py-3 space-y-4">
        {/* App Name */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            App Name
          </label>
          {editingName && !isApproved ? (
            <input
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSubmit();
                if (e.key === "Escape") {
                  setNameValue(appName);
                  setEditingName(false);
                }
              }}
              className="block w-full text-lg font-semibold bg-transparent border-b border-primary/40 focus:border-primary outline-none pb-0.5 text-foreground"
              autoFocus
            />
          ) : (
            <button
              type="button"
              className={`block text-lg font-semibold text-foreground ${
                !isApproved
                  ? "hover:text-primary cursor-text transition-colors"
                  : ""
              }`}
              onClick={() => {
                if (!isApproved) {
                  setNameValue(appName);
                  setEditingName(true);
                }
              }}
              disabled={isApproved}
            >
              {appName || "Untitled App"}
            </button>
          )}
        </div>

        {/* User Prompt */}
        {userPrompt && (
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Prompt
            </label>
            <MiniPlanUserPrompt prompt={userPrompt} attachments={attachments} />
          </div>
        )}

        {/* Tech Stack & Theme Row */}
        <div className="grid grid-cols-2 gap-3">
          {/* Tech Stack */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Layout size={10} />
              Tech Stack
            </label>
            {isApproved ? (
              <span className="text-sm text-foreground/80">
                {templates?.find((t) => t.id === templateId)?.title ??
                  templateId}
              </span>
            ) : (
              <select
                data-testid="mini-plan-template-select"
                value={templateId}
                onChange={(e) => handleFieldEdit("templateId", e.target.value)}
                className="w-full text-sm bg-background border border-border/50 rounded-md px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                {(templates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Theme */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Paintbrush size={10} />
              Theme
            </label>
            {isApproved ? (
              <span className="text-sm text-foreground/80">
                {allThemeOptions.find((t) => t.id === themeId)?.name ?? themeId}
              </span>
            ) : (
              <select
                data-testid="mini-plan-theme-select"
                value={themeId}
                onChange={(e) => handleFieldEdit("themeId", e.target.value)}
                className="w-full text-sm bg-background border border-border/50 rounded-md px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                {(themes ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                {customThemes.length > 0 && (
                  <optgroup label="Custom Themes">
                    {customThemes.map((t) => (
                      <option key={`custom:${t.id}`} value={`custom:${t.id}`}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
          </div>
        </div>

        {/* Main Color */}
        {mainColor && (
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Palette size={10} />
              Main Color
            </label>
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-md border border-border/50 shrink-0"
                style={{ backgroundColor: mainColor }}
              />
              {isApproved ? (
                <span className="text-sm text-foreground/80 font-mono">
                  {mainColor}
                </span>
              ) : (
                <input
                  type="text"
                  value={mainColor}
                  onChange={(e) => handleFieldEdit("mainColor", e.target.value)}
                  className="text-sm font-mono bg-background border border-border/50 rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 w-28"
                  placeholder="#000000"
                />
              )}
              {!isApproved && (
                <input
                  type="color"
                  value={mainColor}
                  onChange={(e) => handleFieldEdit("mainColor", e.target.value)}
                  className="w-7 h-7 p-0 border-0 bg-transparent cursor-pointer"
                />
              )}
            </div>
          </div>
        )}

        {/* Design Direction */}
        {designDirection && (
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Design Direction
            </label>
            <MiniPlanDesignDirection direction={designDirection} />
          </div>
        )}

        {/* Visuals */}
        {(visuals.length > 0 || isInProgress) && (
          <div className="space-y-1">
            <MiniPlanVisuals
              visuals={visuals}
              state={isInProgress ? "pending" : "finished"}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      {!isInProgress && appName && (
        <div className="px-4 py-3 border-t border-border/50 flex justify-end">
          {isApproved ? (
            <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <Check size={16} className="text-emerald-500" />
              Plan approved
            </span>
          ) : (
            <button
              type="button"
              onClick={handleApprove}
              disabled={isApproving || isChatStreaming}
              className="flex items-center gap-1.5 text-sm font-medium text-primary-foreground px-5 py-2 bg-primary rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isApproving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Approving...
                </>
              ) : (
                <>
                  <Check size={14} />
                  Approve Plan
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
