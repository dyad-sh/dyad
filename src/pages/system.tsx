import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { ChevronLeft, Cpu } from "lucide-react";

import { ipc } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { activeSettingsTabAtom } from "@/atoms/viewAtoms";
import {
  SYSTEM_GROUPS,
  destinationForTab,
  destinationsInGroup,
  findDestination,
  type SystemDestination,
  type SystemDestinationId,
} from "@/lib/system_sections";
import { SettingsTabbedContent } from "@/components/settings/SettingsTabbedContent";
import { SettingsDraftProvider } from "@/contexts/SettingsDraftContext";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import { showError, showSuccess } from "@/lib/toast";
import InfrastructurePage from "./infrastructure";
import DataSourcesPage from "./data-sources";
import { ParticleBackground } from "@/components/home/ParticleBackground";
import NotesVaultPage from "./notes-vault";
import { notesVaultAtom } from "@/atoms/notesVaultAtoms";

/**
 * The System section.
 *
 * A reorganisation, not a rewrite: every destination renders the screen or the
 * settings tab that already existed, so nothing here changes what any control
 * does. What changes is that eleven technical destinations stop competing for
 * space in the main rail and live behind one entry.
 *
 * The landing overview shows real state only. A count nobody measured would be
 * a decorative number, and a decorative number on a systems page is worse than
 * no number: it is one somebody will act on.
 */

export default function SystemPage({
  followActiveSettingsTab = false,
}: {
  /**
   * Open the destination that owns the currently selected settings tab.
   *
   * Set on the /settings route, where arrivals are deep links: the code that
   * navigates there sets the tab first and expects to land on it, not on an
   * index. Entering System from the rail shows the index instead.
   */
  followActiveSettingsTab?: boolean;
} = {}) {
  const [settingsTab, setSettingsTab] = useAtom(activeSettingsTabAtom);
  const [vaultNotes] = useAtom(notesVaultAtom);
  const [active, setActive] = useState<SystemDestinationId | null>(() =>
    followActiveSettingsTab
      ? (destinationForTab(settingsTab)?.id ?? null)
      : null,
  );
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    void ipc.system
      .getAppVersion()
      .then((version) => setAppVersion(String(version ?? "")))
      .catch(() => setAppVersion(""));
  }, []);

  // Real counts, from the same sources the pages themselves use.
  const infrastructure = useQuery({
    queryKey: ["infrastructure"],
    queryFn: () => ipc.infrastructure.snapshot(),
  });
  const dataSources = useQuery({
    queryKey: ["data-sources"],
    queryFn: () => ipc.dataSource.list(),
  });

  const open = (destination: SystemDestination) => {
    if (destination.renders.kind === "settings-tab") {
      // The settings screen reads its active tab from this atom, so opening a
      // System destination is the same action the settings rail performs.
      setSettingsTab(destination.renders.tab);
    }
    setActive(destination.id);
  };

  const resetEverything = async () => {
    setIsResetting(true);
    try {
      await ipc.system.resetAll();
      showSuccess("Successfully reset everything. Restart the application.");
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "An unknown error occurred",
      );
    } finally {
      setIsResetting(false);
      setIsResetDialogOpen(false);
    }
  };

  /**
   * What to say next to a destination on the landing page.
   *
   * Returns null where nothing real is known, and the row simply shows its
   * one-line summary instead of a fabricated statistic.
   */
  const statusFor = (destination: SystemDestination): string | null => {
    if (destination.id === "infrastructure") {
      const summary = infrastructure.data?.summary;
      if (!summary || summary.total === 0) return null;
      if (summary.offline > 0) return `${summary.offline} offline`;
      if (summary.degraded > 0) return `${summary.degraded} degraded`;
      return `${summary.healthy} healthy`;
    }
    if (destination.id === "data-sources") {
      const sources = dataSources.data;
      if (!sources) return null;
      const connected = sources.filter(
        (source) => source.status === "connected",
      ).length;
      return sources.length === 0
        ? "None connected"
        : `${connected} of ${sources.length} connected`;
    }
    if (destination.id === "notes-vault") {
      return `${vaultNotes.length} ${vaultNotes.length === 1 ? "note" : "notes"}`;
    }
    return null;
  };

  const activeDestination = findDestination(active);

  if (activeDestination) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="system-subheader">
          <button
            type="button"
            onClick={() => setActive(null)}
            className="system-back"
            data-testid="system-back"
          >
            <ChevronLeft className="size-4" />
            System
          </button>
          <span className="system-crumb">
            <activeDestination.icon className="size-3.5" />
            {activeDestination.label}
          </span>
        </div>

        <div
          className={cn(
            "relative min-h-0 flex-1 overflow-auto",
            activeDestination.renders.kind === "settings-tab" &&
              "settings-jarvis home-jarvis bg-background",
          )}
        >
          {activeDestination.renders.kind === "settings-tab" && (
            <ParticleBackground className="z-0" />
          )}
          {/* The original component, unchanged. */}
          {activeDestination.renders.kind === "page" ? (
            activeDestination.renders.route === "/infrastructure" ? (
              <InfrastructurePage />
            ) : activeDestination.renders.route === "notes-vault" ? (
              <NotesVaultPage />
            ) : (
              <DataSourcesPage />
            )
          ) : (
            <div className="relative z-10 mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
              {/* The draft context the settings screen provides. Without it the
                  save bar and the tabs that use drafts lose their edits. */}
              <SettingsDraftProvider>
                <SettingsTabbedContent
                  hideTabList
                  appVersion={appVersion}
                  isResetting={isResetting}
                  onOpenResetDialog={() => setIsResetDialogOpen(true)}
                />
              </SettingsDraftProvider>
            </div>
          )}
        </div>

        <ConfirmationDialog
          isOpen={isResetDialogOpen}
          title="Reset Everything"
          message="Are you sure you want to reset everything? This will delete all your apps, chats, and settings. This action cannot be undone."
          confirmText={isResetting ? "Resetting..." : "Reset Everything"}
          cancelText="Cancel"
          confirmDisabled={isResetting}
          onConfirm={resetEverything}
          onCancel={() => setIsResetDialogOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="settings-jarvis home-jarvis relative flex min-h-full w-full flex-col overflow-auto bg-background">
      <ParticleBackground className="z-0" />
      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="manager-brand-icon">
              <Cpu className="size-4" />
            </div>
            <span className="manager-brand-label font-jarvis-ui">SYSTEM</span>
            <div className="manager-status-dot manager-status-dot--active" />
          </div>
          <h1 className="manager-title font-jarvis-display">
            Control the machine behind Meta Human OS
          </h1>
          <p className="manager-subtitle">
            The machine, the models, the connections and the extensions.
            Everything technical lives here rather than in the main rail.
          </p>
        </header>

        {SYSTEM_GROUPS.map((group) => (
          <section key={group} className="mb-6">
            <h2 className="system-group-label">{group}</h2>
            <div className="system-grid">
              {destinationsInGroup(group).map((destination) => {
                const status = statusFor(destination);
                return (
                  <button
                    key={destination.id}
                    type="button"
                    onClick={() => open(destination)}
                    className="system-card"
                    data-testid={`system-open-${destination.id}`}
                  >
                    <span className="system-card-icon">
                      <destination.icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="system-card-title">
                        {destination.label}
                      </span>
                      <span className="system-card-summary">
                        {destination.summary}
                      </span>
                    </span>
                    {/* Only real state appears here. */}
                    {status && (
                      <span className="system-card-status">{status}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

/** The secondary rail, shown beside System content. */
export function SystemNav({
  active,
  onSelect,
}: {
  active: SystemDestinationId | null;
  onSelect: (id: SystemDestinationId) => void;
}) {
  return (
    <nav className="system-nav">
      {SYSTEM_GROUPS.map((group) => (
        <div key={group}>
          <span className="system-group-label">{group}</span>
          {destinationsInGroup(group).map((destination) => (
            <button
              key={destination.id}
              type="button"
              onClick={() => onSelect(destination.id)}
              className={cn(
                "system-nav-item",
                active === destination.id && "system-nav-item--active",
              )}
            >
              <destination.icon className="size-4 shrink-0" />
              {destination.label}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
