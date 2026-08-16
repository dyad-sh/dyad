import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAtomValue } from "jotai";
import { activeSettingsTabAtom } from "@/atoms/viewAtoms";
import { useSettingsInternal } from "@/hooks/useSettings";
import type { UserSettings } from "@/lib/schemas";
import type { SettingsTabId } from "@/lib/settingsTabs";
import {
  applyAllTabDrafts,
  applySettingsPatch,
  isSettingsTabDirty,
  mergeSettingsPatch,
} from "@/lib/settingsDraftMerge";
import { showSuccess } from "@/lib/toast";

export type SettingsDraftContextValue = {
  effectiveSettings: UserSettings | null;
  patchDraft: (partial: Partial<UserSettings>) => Promise<UserSettings>;
  saveTab: (tabId: SettingsTabId) => Promise<void>;
  saveTabPatch: (
    tabId: SettingsTabId,
    partial: Partial<UserSettings>,
  ) => Promise<UserSettings>;
  discardTab: (tabId: SettingsTabId) => void;
  isTabDirty: (tabId: SettingsTabId) => boolean;
  isSaving: boolean;
};

const SettingsDraftContext = createContext<SettingsDraftContextValue | null>(
  null,
);

export function SettingsDraftProvider({ children }: { children: ReactNode }) {
  const activeTab = useAtomValue(activeSettingsTabAtom);
  const {
    settings: saved,
    updateSettings: persistSettings,
    isUpdatePending,
  } = useSettingsInternal();
  const [draftsByTab, setDraftsByTab] = useState<
    Partial<Record<SettingsTabId, Partial<UserSettings>>>
  >({});

  const effectiveSettings = useMemo(
    () => (saved ? applyAllTabDrafts(saved, draftsByTab) : null),
    [saved, draftsByTab],
  );

  const patchDraft = useCallback(
    async (partial: Partial<UserSettings>) => {
      if (!saved) {
        throw new Error("Settings not loaded");
      }
      setDraftsByTab((prev) => ({
        ...prev,
        [activeTab]: mergeSettingsPatch(prev[activeTab] ?? {}, partial),
      }));
      const nextDraft = mergeSettingsPatch(
        draftsByTab[activeTab] ?? {},
        partial,
      );
      return applySettingsPatch(saved, nextDraft);
    },
    [activeTab, draftsByTab, saved],
  );

  const saveTab = useCallback(
    async (tabId: SettingsTabId) => {
      const draft = draftsByTab[tabId];
      if (!draft || !saved || !isSettingsTabDirty(saved, draft)) {
        return;
      }
      await persistSettings(draft);
      setDraftsByTab((prev) => {
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
      showSuccess("Settings saved");
    },
    [draftsByTab, persistSettings, saved],
  );

  /**
   * Persist a change that has its own Save action. Passing the new patch into
   * this function avoids waiting for React to publish a staged draft before
   * saveTab reads it.
   */
  const saveTabPatch = useCallback(
    async (tabId: SettingsTabId, partial: Partial<UserSettings>) => {
      if (!saved) {
        throw new Error("Settings not loaded");
      }

      const combinedDraft = mergeSettingsPatch(
        draftsByTab[tabId] ?? {},
        partial,
      );
      const updated = await persistSettings(combinedDraft);
      setDraftsByTab((prev) => {
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
      showSuccess("Settings saved");
      return updated;
    },
    [draftsByTab, persistSettings, saved],
  );

  const discardTab = useCallback((tabId: SettingsTabId) => {
    setDraftsByTab((prev) => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  const isTabDirty = useCallback(
    (tabId: SettingsTabId) =>
      saved ? isSettingsTabDirty(saved, draftsByTab[tabId]) : false,
    [draftsByTab, saved],
  );

  const value = useMemo(
    () => ({
      effectiveSettings,
      patchDraft,
      saveTab,
      saveTabPatch,
      discardTab,
      isTabDirty,
      isSaving: isUpdatePending,
    }),
    [
      discardTab,
      effectiveSettings,
      isTabDirty,
      isUpdatePending,
      patchDraft,
      saveTab,
      saveTabPatch,
    ],
  );

  return (
    <SettingsDraftContext.Provider value={value}>
      {children}
    </SettingsDraftContext.Provider>
  );
}

export function useSettingsDraftContext(): SettingsDraftContextValue | null {
  return useContext(SettingsDraftContext);
}
