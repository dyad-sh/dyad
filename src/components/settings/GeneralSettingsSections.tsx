import { ThemeSelector } from "./ThemeSelector";
import { ZoomSelector } from "@/components/ZoomSelector";
import { LanguageSelector } from "@/components/LanguageSelector";
import { SECTION_IDS, SETTING_IDS } from "@/lib/settingsSearchIndex";
import { useSettingsInternal } from "@/hooks/useSettings";
import { Monitor, Smartphone } from "lucide-react";

const settingsCardClass =
  "rounded-xl border border-cyan-500/15 bg-[rgba(8,18,36,0.72)] p-6 shadow-[0_0_24px_rgba(0,229,255,0.06)] backdrop-blur-md scroll-mt-24";

export function SystemSettings({ appVersion }: { appVersion: string | null }) {
  const { settings, updateSettings } = useSettingsInternal();
  const appLayoutMode = settings?.appLayoutMode ?? "landscape";

  return (
    <div id={SECTION_IDS.general} className={settingsCardClass}>
      <div className="mb-6">
        <h2 className="font-jarvis-ui text-sm font-medium uppercase tracking-widest text-cyan-300/70">
          System
        </h2>
        <p className="mt-2 text-sm text-cyan-100/45">
          Appearance, language, and display preferences.
        </p>
      </div>

      <div className="space-y-5">
        <div id={SETTING_IDS.theme} className="space-y-2">
          <label className="text-sm font-medium text-cyan-50/85">Theme</label>
          <ThemeSelector />
        </div>
        <div>
          <LanguageSelector />
        </div>

        <div
          id={SETTING_IDS.appLayout}
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4"
        >
          <div className="min-w-24">
            <p className="text-sm font-medium text-cyan-50/85">App layout</p>
            <p className="mt-0.5 text-xs text-cyan-100/35">
              Change the shape of the application window.
            </p>
          </div>

          <div className="relative flex w-fit rounded-lg border border-cyan-500/15 bg-cyan-950/35 p-1">
            {(
              [
                { mode: "landscape", label: "Landscape", icon: Monitor },
                { mode: "portrait", label: "Portrait", icon: Smartphone },
              ] as const
            ).map(({ mode, label, icon: Icon }) => (
              <button
                key={mode}
                type="button"
                aria-pressed={appLayoutMode === mode}
                onClick={() => void updateSettings({ appLayoutMode: mode })}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                  appLayoutMode === mode
                    ? "bg-cyan-500/15 text-cyan-50 shadow-sm"
                    : "text-cyan-100/45 hover:text-cyan-50"
                }`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div id={SETTING_IDS.zoom}>
          <ZoomSelector />
        </div>
      </div>

      <div className="mt-6 flex items-center border-t border-cyan-500/10 pt-4 text-xs text-cyan-100/35">
        <span className="mr-2">Version</span>
        <span className="rounded bg-cyan-950/40 px-2 py-1 font-mono text-cyan-100/60">
          {appVersion ?? "-"}
        </span>
      </div>
    </div>
  );
}
