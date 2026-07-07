import React, { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Sparkles,
  Check,
  Loader2,
  Palette,
  Layout,
  Paintbrush,
  Pencil,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { appBlueprintStateAtom } from "@/atoms/appBlueprintAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useTemplates } from "@/hooks/useTemplates";
import { useCustomThemes } from "@/hooks/useCustomThemes";
import { useThemes } from "@/hooks/useThemes";
import { useLoadApp } from "@/hooks/useLoadApp";
import { ipc } from "@/ipc/types";
import {
  sanitizeAppDisplayName,
  slugifyAppFolderName,
} from "@/shared/app_names";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type {
  AppBlueprintEditableField,
  AppBlueprintVisualEditableField,
  AppBlueprintVisual,
} from "@/ipc/types/app_blueprint";
import { showError } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";
import { AppBlueprintUserPrompt } from "./AppBlueprintUserPrompt";
import { AppBlueprintDesignDirection } from "./AppBlueprintDesignDirection";
import { AppBlueprintVisuals } from "./AppBlueprintVisuals";
import { getAppBlueprintTemplateOptions } from "./appBlueprintTemplateOptions";
import { AppBlueprintNameConflictDialog } from "./AppBlueprintNameConflictDialog";
import type { CustomTagState } from "./stateTypes";

function isNameConflictError(error: unknown): boolean {
  return error instanceof DyadError && error.kind === DyadErrorKind.Conflict;
}

interface DyadAppBlueprintCardProps {
  node: {
    properties: {
      "app-name"?: string;
      template?: string;
      theme?: string;
      "design-direction"?: string;
      "primary-color"?: string;
      complete?: string;
      state?: CustomTagState;
    };
  };
}

export const DyadAppBlueprintCard: React.FC<DyadAppBlueprintCardProps> = ({
  node,
}) => {
  const props = node.properties;
  const chatId = useAtomValue(selectedChatIdAtom);
  const appBlueprintState = useAtomValue(appBlueprintStateAtom);
  const setAppBlueprintState = useSetAtom(appBlueprintStateAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  // hasChatId: false so we don't read it from the router; we pass it explicitly.
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const { app, refreshApp } = useLoadApp(selectedAppId);
  const queryClient = useQueryClient();
  const { templates } = useTemplates();
  const { themes } = useThemes();
  const { customThemes } = useCustomThemes();

  const isApproved = chatId
    ? appBlueprintState.approvedChatIds.has(chatId)
    : false;
  const planData = chatId ? appBlueprintState.plansByChatId.get(chatId) : null;
  const isTimedOut = chatId
    ? appBlueprintState.timedOutChatIds.has(chatId)
    : false;
  // Use atom data if available, fall back to XML attributes. Preserve
  // intentionally empty user edits (e.g. cleared app name) by checking for
  // live plan data presence rather than truthiness of individual fields.
  const appName =
    planData != null ? planData.appName : (props["app-name"] ?? "");
  const templateId =
    planData != null ? planData.templateId : (props.template ?? "react");
  const themeId =
    planData != null ? planData.themeId : (props.theme ?? "default");
  const designDirection =
    planData != null
      ? planData.designDirection
      : (props["design-direction"] ?? "");
  const primaryColor =
    planData != null ? planData.primaryColor : (props["primary-color"] ?? "");
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

  // The XML tag's `complete` attribute is the definitive signal that the
  // agent finished emitting the blueprint. Don't gate readiness on a separate
  // visuals-update event — if the visuals event never arrives, the card would
  // otherwise stay permanently disabled.
  const isReady = props.state !== "pending" && props.complete !== "false";
  const inputIdPrefix = chatId ? `app-blueprint-${chatId}` : "app-blueprint";
  const appNameFieldId = `${inputIdPrefix}-app-name`;
  const templateFieldId = `${inputIdPrefix}-template`;
  const themeFieldId = `${inputIdPrefix}-theme`;
  const primaryColorTextFieldId = `${inputIdPrefix}-primary-color-text`;
  const primaryColorPickerFieldId = `${inputIdPrefix}-primary-color-picker`;
  const statusId = `${inputIdPrefix}-status`;
  const templateOptions = getAppBlueprintTemplateOptions(templates, templateId);

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(appName);
  const [colorTextValue, setColorTextValue] = useState(primaryColor);
  const [isApproving, setIsApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  // When non-null, the name-conflict dialog is open and holds the rejected name
  // (the name that was already in use) to pre-fill into the dialog's input.
  const [nameConflictName, setNameConflictName] = useState<string | null>(null);
  // Synchronous guard against fast double-clicks on Approve — `isApproving`
  // state wouldn't see a second click within the same render tick.
  const approvingRef = useRef(false);

  // Sync local state when props change (e.g. from streaming updates)
  useEffect(() => {
    if (!editingName) {
      setNameValue(appName);
    }
  }, [appName, editingName]);

  useEffect(() => {
    setColorTextValue(primaryColor);
  }, [primaryColor]);

  const handleVisualEdit = useCallback(
    (
      visualId: string,
      field: AppBlueprintVisualEditableField,
      value: string,
    ) => {
      if (!chatId || isApproved) return;

      // Update local state immediately
      setAppBlueprintState((prev) => {
        const nextPlans = new Map(prev.plansByChatId);
        const existing = nextPlans.get(chatId);
        if (existing) {
          nextPlans.set(chatId, {
            ...existing,
            visuals: existing.visuals.map((v) =>
              v.id === visualId ? { ...v, [field]: value } : v,
            ),
          });
        }
        return { ...prev, plansByChatId: nextPlans };
      });

      // Persist to main process
      void ipc.appBlueprint
        .editVisual({ chatId, visualId, field, value })
        .catch((error) => {
          console.error("Failed to persist visual edit:", error);
          showError("Could not save visual changes. Please try again.");
        });
    },
    [chatId, isApproved, setAppBlueprintState],
  );

  const handleAddVisual = useCallback(
    (visual: Omit<AppBlueprintVisual, "id">) => {
      if (!chatId || isApproved) return;

      // Generate a temporary ID for optimistic update
      const tempId = `visual_${Date.now().toString(36)}`;

      // Update local state immediately
      setAppBlueprintState((prev) => {
        const nextPlans = new Map(prev.plansByChatId);
        const existing = nextPlans.get(chatId);
        if (existing) {
          nextPlans.set(chatId, {
            ...existing,
            visuals: [...existing.visuals, { ...visual, id: tempId }],
          });
        }
        return { ...prev, plansByChatId: nextPlans };
      });

      // Persist to main process and update with real ID
      void ipc.appBlueprint
        .addVisual({ chatId, ...visual })
        .then(({ visualId }) => {
          if (visualId && visualId !== tempId) {
            setAppBlueprintState((prev) => {
              const nextPlans = new Map(prev.plansByChatId);
              const existing = nextPlans.get(chatId);
              if (existing) {
                nextPlans.set(chatId, {
                  ...existing,
                  visuals: existing.visuals.map((v) =>
                    v.id === tempId ? { ...v, id: visualId } : v,
                  ),
                });
              }
              return { ...prev, plansByChatId: nextPlans };
            });
          }
        })
        .catch((error) => {
          console.error("Failed to add visual:", error);
          showError("Could not add visual. Please try again.");
          // Roll back optimistic update
          setAppBlueprintState((prev) => {
            const nextPlans = new Map(prev.plansByChatId);
            const existing = nextPlans.get(chatId);
            if (existing) {
              nextPlans.set(chatId, {
                ...existing,
                visuals: existing.visuals.filter((v) => v.id !== tempId),
              });
            }
            return { ...prev, plansByChatId: nextPlans };
          });
        });
    },
    [chatId, isApproved, setAppBlueprintState],
  );

  const handleRemoveVisual = useCallback(
    (visualId: string) => {
      if (!chatId || isApproved) return;

      // Capture for rollback before mutating state — reading inside the
      // updater is unsafe because React may invoke updaters more than once.
      const removedVisual = appBlueprintState.plansByChatId
        .get(chatId)
        ?.visuals.find((v) => v.id === visualId);
      if (!removedVisual) return;

      // Update local state immediately
      setAppBlueprintState((prev) => {
        const nextPlans = new Map(prev.plansByChatId);
        const existing = nextPlans.get(chatId);
        if (existing) {
          nextPlans.set(chatId, {
            ...existing,
            visuals: existing.visuals.filter((v) => v.id !== visualId),
          });
        }
        return { ...prev, plansByChatId: nextPlans };
      });

      // Persist to main process
      void ipc.appBlueprint
        .removeVisual({ chatId, visualId })
        .catch((error) => {
          console.error("Failed to remove visual:", error);
          showError("Could not remove visual. Please try again.");
          // Roll back
          setAppBlueprintState((prev) => {
            const nextPlans = new Map(prev.plansByChatId);
            const existing = nextPlans.get(chatId);
            if (existing) {
              nextPlans.set(chatId, {
                ...existing,
                visuals: [...existing.visuals, removedVisual],
              });
            }
            return { ...prev, plansByChatId: nextPlans };
          });
        });
    },
    [chatId, isApproved, appBlueprintState, setAppBlueprintState],
  );

  const handleFieldEdit = useCallback(
    (field: AppBlueprintEditableField, value: string) => {
      if (!chatId || isApproved) return Promise.resolve(false);

      // Update local state immediately
      setAppBlueprintState((prev) => {
        const nextPlans = new Map(prev.plansByChatId);
        const existing = nextPlans.get(chatId);
        if (existing) {
          nextPlans.set(chatId, { ...existing, [field]: value });
        }
        return { ...prev, plansByChatId: nextPlans };
      });

      // Persist to main process. Resolves to `true` only when the write lands
      // and `false` when it fails, so callers that gate a follow-up IPC (e.g.
      // approval) can bail instead of proceeding with an unsaved value.
      return ipc.appBlueprint
        .editField({ chatId, field, value })
        .then(() => true)
        .catch((error) => {
          console.error("Failed to persist app blueprint field edit:", error);
          showError("Could not save app blueprint changes. Please try again.");
          return false;
        });
    },
    [chatId, isApproved, setAppBlueprintState],
  );

  const handleApprove = useCallback(
    async (overrideAppName?: string) => {
      if (!chatId || isApproved) return;
      if (approvingRef.current) return;

      const plan = appBlueprintState.plansByChatId.get(chatId);
      if (!plan) {
        showError("Blueprint data is unavailable. Please regenerate the plan.");
        return;
      }

      // When re-approving after a name conflict, the user supplied a new name
      // in the dialog. Use it for the rename + follow-up and persist it back
      // into the blueprint so the agent builds under the corrected name. Guard
      // on `typeof string` so an accidental event arg (e.g. onClick passing the
      // MouseEvent) can never be mistaken for an override.
      const override =
        typeof overrideAppName === "string" ? overrideAppName.trim() : "";
      const effectiveAppName = override || plan.appName;

      // Set the in-progress guard before any await so a slow name-persist can't
      // leave the underlying "Approve Plan" button live for a second click that
      // would start a concurrent approval.
      approvingRef.current = true;
      setIsApproving(true);
      setApprovalError(null);

      if (override && effectiveAppName !== plan.appName) {
        // Await the persist so the blueprint and the app row can't disagree
        // about the name if the edit and approve IPC calls race. Bail if it
        // fails so we never approve under a name that was never saved (the
        // edit handler already surfaced the error to the user).
        const persisted = await handleFieldEdit("appName", effectiveAppName);
        if (!persisted) {
          approvingRef.current = false;
          setIsApproving(false);
          return;
        }
      }

      // Optimistically mark as approved so UI updates immediately
      setAppBlueprintState((prev) => {
        const nextApproved = new Set(prev.approvedChatIds);
        nextApproved.add(chatId);
        return { ...prev, approvedChatIds: nextApproved };
      });
      try {
        const applyErrors: string[] = [];
        let templateApplyFailed = false;
        let renameFailed = false;
        let nameConflictDetected = false;
        // The name the app actually ends up with — the handler may append a
        // collision suffix ("Todo App" -> "Todo App 2").
        let finalAppName = effectiveAppName;
        const recordApplyError = (message: string, error: unknown) => {
          console.error(message, error);
          const detail =
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : undefined;
          applyErrors.push(detail ? `${message} (${detail})` : message);
        };

        // Apply plan settings to the app before resolving the agent's promise
        if (selectedAppId) {
          let currentApp = app;
          let templateNeedsRestart = false;

          if (!currentApp) {
            try {
              currentApp = await ipc.app.getApp(selectedAppId);
            } catch (error) {
              recordApplyError(
                "Could not load the app before applying the app blueprint.",
                error,
              );
            }
          }

          // Rename the app and its folder to match the new name. Approval
          // always normalizes the folder to the canonical slug of the final
          // display name; the handler no-ops when both already match and
          // auto-suffixes name/folder collisions instead of failing.
          if (currentApp && effectiveAppName) {
            const desiredName = sanitizeAppDisplayName(effectiveAppName);
            const desiredFolder = slugifyAppFolderName(desiredName);
            const currentFolder =
              currentApp.path.split(/[\\/]/).filter(Boolean).pop() ??
              currentApp.path;
            const folderChanged = desiredFolder !== currentFolder;
            const nameChanged = desiredName !== currentApp.name;
            if (nameChanged || folderChanged) {
              try {
                const renamed = await ipc.app.renameApp({
                  appId: selectedAppId,
                  appName: desiredName,
                  appPath: desiredFolder,
                  autoResolveConflicts: true,
                });
                finalAppName = renamed.name;
                if (renamed.name !== effectiveAppName) {
                  // Persist the suffixed name back into the blueprint so the
                  // blueprint, app row, and agent all agree on the name.
                  try {
                    await ipc.appBlueprint.editField({
                      chatId,
                      field: "appName",
                      value: renamed.name,
                    });
                    setAppBlueprintState((prev) => {
                      const nextPlans = new Map(prev.plansByChatId);
                      const existing = nextPlans.get(chatId);
                      if (existing) {
                        nextPlans.set(chatId, {
                          ...existing,
                          appName: renamed.name,
                        });
                      }
                      return { ...prev, plansByChatId: nextPlans };
                    });
                  } catch (error) {
                    recordApplyError(
                      `The app was renamed to "${renamed.name}" but the blueprint could not be updated to match.`,
                      error,
                    );
                  }
                }
              } catch (error) {
                // Conflicts normally auto-resolve with a numeric suffix; this
                // dialog remains as a fallback for unexpected conflict races,
                // prompting the user to pick a different name and re-approve.
                if (isNameConflictError(error)) {
                  nameConflictDetected = true;
                } else {
                  // Other rename failures (e.g. invalid path) mean the agent
                  // would build under the old name/path. Treat them as fatal so
                  // the user can fix the blueprint and re-approve.
                  renameFailed = true;
                  recordApplyError("Could not rename the app.", error);
                }
              }
            }
          }

          if (nameConflictDetected) {
            // Roll back the optimistic approval and open the rename dialog so the
            // user can choose a different name and re-approve. We bail before
            // touching the template/theme so nothing is half-applied.
            setAppBlueprintState((prev) => {
              const nextApproved = new Set(prev.approvedChatIds);
              nextApproved.delete(chatId);
              return { ...prev, approvedChatIds: nextApproved };
            });
            setNameConflictName(effectiveAppName);
            return;
          }

          if (!renameFailed) {
            try {
              const { needsRestart } = await ipc.template.applyAppTemplate({
                appId: selectedAppId,
                templateId: plan.templateId,
                chatId: chatId ?? undefined,
              });
              templateNeedsRestart = needsRestart;
            } catch (error) {
              templateApplyFailed = true;
              recordApplyError("Could not apply the selected template.", error);
            }
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
          } catch (error) {
            recordApplyError("Could not apply the selected theme.", error);
          }

          if (templateNeedsRestart) {
            try {
              await ipc.app.restartApp({
                appId: selectedAppId,
                removeNodeModules: true,
              });
            } catch (error) {
              recordApplyError(
                "Could not restart the app after the template change.",
                error,
              );
            }
          }

          // Refresh app data so the sidebar/header reflect the new name. Also
          // invalidate token counts since AI_RULES.md changes with the
          // template, which alters the system-prompt size.
          await Promise.all([
            refreshApp(),
            queryClient.invalidateQueries({ queryKey: queryKeys.apps.all }),
            queryClient.invalidateQueries({
              queryKey: queryKeys.tokenCount.all,
            }),
          ]);
        }

        // Template application and rename are critical — if either failed,
        // don't unblock the agent so the user can fix the plan and re-approve.
        // Otherwise the agent would build for the wrong framework or under the
        // wrong app name/path.
        if (templateApplyFailed || renameFailed) {
          setAppBlueprintState((prev) => {
            const nextApproved = new Set(prev.approvedChatIds);
            nextApproved.delete(chatId);
            return { ...prev, approvedChatIds: nextApproved };
          });
          const errorPrefix = renameFailed
            ? "Could not rename the app. Please choose a different name and try again"
            : "Could not apply the selected template. Please review the plan and try again";
          const errorMessage = `${errorPrefix}:\n- ${applyErrors.join("\n- ")}`;
          setApprovalError(errorMessage);
          showError(errorMessage);
          return;
        }

        if (applyErrors.length > 0) {
          const errorMessage = `Blueprint approved, but some changes could not be applied:\n- ${applyErrors.join("\n- ")}`;
          setApprovalError(errorMessage);
          showError(errorMessage);
        }

        // Flip the per-app `needsAppBlueprint` flag and notify the renderer.
        // The agent's previous turn already ended (the write_app_blueprint tool
        // returned immediately and `stopWhen` stopped the generation), so we can
        // start a fresh chat stream right away — it will rebuild `AgentContext`
        // from the renamed app row.
        await ipc.appBlueprint.approve({ chatId });

        // Build the follow-up user message with the approved blueprint inline.
        const visualsSummary =
          plan.visuals.length > 0
            ? plan.visuals
                .map(
                  (v) => `- ${v.type}: ${v.description}\n  Prompt: ${v.prompt}`,
                )
                .join("\n")
            : "No visuals planned";

        const followUpPrompt = [
          "The app blueprint has been approved. Please build the app based on the following approved blueprint:",
          "",
          `App Name: ${finalAppName}`,
          `Template: ${plan.templateId}`,
          `Theme: ${plan.themeId}`,
          `Primary Color: ${plan.primaryColor}`,
          `Design Direction: ${plan.designDirection}`,
          "",
          "Visual Assets:",
          visualsSummary,
          "",
          `Original Prompt: ${plan.userPrompt}`,
        ].join("\n");

        // Send the follow-up message in its own try/catch — the blueprint is
        // already approved and persisted at this point, so a failure here is a
        // separate "follow-up message failed" condition. Rolling back approval
        // would be misleading (the rename, template, theme, and DB flag have
        // all succeeded) and would block the user from continuing.
        try {
          await streamMessage({ chatId, prompt: followUpPrompt });
        } catch (error) {
          console.error(
            "Failed to send app blueprint follow-up message:",
            error,
          );
          const followUpError =
            "Blueprint approved, but the follow-up message could not be sent. You can type your next message to continue building.";
          setApprovalError(followUpError);
          showError(followUpError);
        }
      } catch (error) {
        console.error("Failed to approve app blueprint:", error);
        setAppBlueprintState((prev) => {
          const nextApproved = new Set(prev.approvedChatIds);
          nextApproved.delete(chatId);
          return { ...prev, approvedChatIds: nextApproved };
        });
        setApprovalError(
          "Failed to approve the app blueprint. Please try again.",
        );
        showError("Failed to approve the app blueprint. Please try again.");
      } finally {
        setIsApproving(false);
        approvingRef.current = false;
      }
    },
    [
      chatId,
      isApproved,
      appBlueprintState,
      selectedAppId,
      app,
      refreshApp,
      queryClient,
      setAppBlueprintState,
      streamMessage,
      handleFieldEdit,
    ],
  );

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
      aria-busy={!isReady}
      className={`my-4 border rounded-lg overflow-hidden transition-colors bg-card ${
        !isReady
          ? "border-primary/60"
          : isApproved
            ? "border-emerald-500/30"
            : "border-primary/20"
      }`}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-2">
          <Sparkles
            className={`text-primary ${!isReady ? "animate-pulse" : ""}`}
            size={18}
          />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            App Blueprint
          </span>
        </div>
        {!isReady && (
          <span className="flex items-center gap-1.5 text-xs text-primary px-3 py-1 bg-primary/10 rounded-md font-medium">
            <Loader2 size={12} className="animate-spin" />
            Generating...
          </span>
        )}
      </div>

      {/* Progress bar during generation */}
      {!isReady && (
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
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            App Name
          </div>
          {editingName && !isApproved ? (
            <input
              id={appNameFieldId}
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
              aria-label="App Name"
              className="block w-full text-lg font-semibold bg-transparent border-b border-primary/40 focus:border-primary outline-none pb-0.5 text-foreground"
              autoFocus
            />
          ) : (
            <button
              id={appNameFieldId}
              type="button"
              aria-label="Edit app name"
              title={isApproved ? undefined : "Edit app name"}
              className={`group inline-flex items-center gap-1 text-lg font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-sm ${
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
              <span>{appName || "Untitled App"}</span>
              {!isApproved && (
                <Pencil
                  size={14}
                  className="text-muted-foreground/70 transition-colors group-hover:text-primary group-focus-visible:text-primary"
                  aria-hidden="true"
                />
              )}
            </button>
          )}
        </div>

        {/* User Prompt */}
        {userPrompt && (
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Prompt
            </div>
            <AppBlueprintUserPrompt
              prompt={userPrompt}
              attachments={attachments}
            />
          </div>
        )}

        {/* Tech Stack & Theme Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Tech Stack */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Layout size={10} />
              Tech Stack
            </div>
            {isApproved ? (
              <span className="text-sm text-foreground/80">
                {templates?.find((t) => t.id === templateId)?.title ??
                  templateId}
              </span>
            ) : (
              <select
                id={templateFieldId}
                aria-label="Tech Stack"
                data-testid="app-blueprint-template-select"
                value={templateId}
                onChange={(e) => handleFieldEdit("templateId", e.target.value)}
                className="w-full text-sm bg-background border border-border/50 rounded-md px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                {!(templates ?? []).some((t) => t.id === templateId) && (
                  <option value={templateId} disabled>
                    Unknown template ({templateId})
                  </option>
                )}
                {templateOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Theme */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Paintbrush size={10} />
              Theme
            </div>
            {isApproved ? (
              <span className="text-sm text-foreground/80">
                {allThemeOptions.find((t) => t.id === themeId)?.name ?? themeId}
              </span>
            ) : (
              <select
                id={themeFieldId}
                aria-label="Theme"
                data-testid="app-blueprint-theme-select"
                value={themeId}
                onChange={(e) => handleFieldEdit("themeId", e.target.value)}
                className="w-full text-sm bg-background border border-border/50 rounded-md px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                {!allThemeOptions.some((t) => t.id === themeId) && (
                  <option value={themeId} disabled>
                    Unknown theme ({themeId})
                  </option>
                )}
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

        {/* Primary Color */}
        {(primaryColor || !isApproved) && (
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Palette size={10} />
              Primary Color
            </div>
            <div className="flex items-center gap-2">
              {isApproved ? (
                <>
                  {primaryColor && (
                    <div
                      className="w-7 h-7 rounded-md border border-border/50 shrink-0"
                      style={{ backgroundColor: primaryColor }}
                    />
                  )}
                  <span className="text-sm text-foreground/80 font-mono">
                    {primaryColor}
                  </span>
                </>
              ) : (
                <>
                  <input
                    id={primaryColorPickerFieldId}
                    type="color"
                    aria-label="Primary Color Picker"
                    value={primaryColor || "#000000"}
                    onChange={(e) => {
                      setColorTextValue(e.target.value);
                      handleFieldEdit("primaryColor", e.target.value);
                    }}
                    className="w-7 h-7 p-0 border border-border/50 rounded-md bg-transparent cursor-pointer shrink-0"
                  />
                  <input
                    id={primaryColorTextFieldId}
                    type="text"
                    aria-label="Primary Color Hex Code"
                    value={colorTextValue}
                    onChange={(e) => setColorTextValue(e.target.value)}
                    onBlur={() => {
                      if (/^#[0-9a-fA-F]{6}$/.test(colorTextValue)) {
                        handleFieldEdit("primaryColor", colorTextValue);
                      } else {
                        setColorTextValue(primaryColor);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="text-sm font-mono bg-background border border-border/50 rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 w-28"
                    placeholder="#000000"
                  />
                </>
              )}
            </div>
          </div>
        )}

        {/* Design Direction */}
        {(designDirection || !isApproved) && (
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Design Direction
            </div>
            <AppBlueprintDesignDirection
              direction={designDirection}
              isApproved={isApproved}
              onEdit={(value) => handleFieldEdit("designDirection", value)}
            />
          </div>
        )}

        {/* Visuals */}
        {(visuals.length > 0 || !isReady || !isApproved) && (
          <div className="space-y-1">
            <AppBlueprintVisuals
              visuals={visuals}
              state={isReady ? "finished" : "pending"}
              isApproved={isApproved}
              onEditVisual={handleVisualEdit}
              onAddVisual={handleAddVisual}
              onRemoveVisual={handleRemoveVisual}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className={`px-4 py-3 border-t border-border/50 flex gap-3 items-start justify-between`}
      >
        {isApproved ? (
          <>
            {approvalError && (
              <p className="max-w-md text-xs text-destructive whitespace-pre-wrap">
                {approvalError}
              </p>
            )}
            <span
              className={`ml-auto flex items-center gap-1.5 text-sm font-medium ${
                approvalError
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {isApproving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Applying plan...
                </>
              ) : approvalError ? (
                <>
                  <AlertCircle size={16} className="text-amber-500" />
                  Plan approved with issues
                </>
              ) : (
                <>
                  <Check size={16} className="text-emerald-500" />
                  Plan approved
                </>
              )}
            </span>
          </>
        ) : (
          <>
            <p
              id={statusId}
              role="status"
              aria-live="polite"
              className={`max-w-md text-xs ${
                isTimedOut
                  ? "text-destructive font-medium"
                  : isReady
                    ? "text-emerald-600 dark:text-emerald-400 font-medium"
                    : "text-muted-foreground"
              }`}
            >
              {isTimedOut
                ? "Blueprint timed out — start a new chat to try again."
                : isReady
                  ? "Your app blueprint is ready to review."
                  : "Preparing app blueprint..."}
            </p>
            <button
              type="button"
              onClick={() => handleApprove()}
              disabled={!isReady || !appName || isApproving || isTimedOut}
              aria-describedby={statusId}
              className="flex items-center gap-1.5 text-sm font-medium text-primary-foreground px-5 py-2 bg-primary rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isApproving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Applying plan...
                </>
              ) : isTimedOut ? (
                "Plan timed out"
              ) : !isReady ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Generating...
                </>
              ) : !appName ? (
                "Add an app name to continue"
              ) : (
                <>
                  <Check size={14} />
                  Approve Plan
                </>
              )}
            </button>
          </>
        )}
      </div>

      <AppBlueprintNameConflictDialog
        rejectedName={nameConflictName ?? ""}
        isOpen={nameConflictName !== null}
        onOpenChange={(open) => {
          if (!open) setNameConflictName(null);
        }}
        onSubmit={(newName) => {
          setNameConflictName(null);
          void handleApprove(newName);
        }}
      />
    </div>
  );
};
