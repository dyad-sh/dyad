import { Globe2, MousePointer2, ShieldAlert, Terminal } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { SECTION_IDS, SETTING_IDS } from "@/lib/settingsSearchIndex";

const accessOptions = [
  {
    key: "terminal",
    settingId: SETTING_IDS.chatAgentTerminalAccess,
    title: "Terminal access",
    description:
      "Run shell commands from Chat Agent. Every command is shown for confirmation before it runs.",
    icon: Terminal,
  },
  {
    key: "browser",
    settingId: SETTING_IDS.chatAgentBrowserAccess,
    title: "Browser use",
    description:
      "Open and read web pages when a task needs information beyond search results.",
    icon: Globe2,
  },
  {
    key: "computer",
    settingId: SETTING_IDS.chatAgentComputerAccess,
    title: "Computer use",
    description:
      "Allow basic macOS actions such as opening an app, clicking, typing, and pressing a key. Every action requires confirmation.",
    icon: MousePointer2,
  },
] as const;

export function ChatAgentSystemAccessSettings() {
  const { settings, updateSettings } = useSettings();
  const access = settings?.chatAgentSystemAccess ?? {};

  return (
    <section
      id={SECTION_IDS.systemAccess}
      className="scroll-mt-24 rounded-xl border border-cyan-500/15 bg-[rgba(8,18,36,0.72)] p-6 shadow-[0_0_24px_rgba(0,229,255,0.06)] backdrop-blur-md"
    >
      <div className="mb-5">
        <h2 className="font-jarvis-ui text-sm font-medium uppercase tracking-widest text-cyan-300/70">
          System Access
        </h2>
        <p className="mt-2 text-sm text-cyan-100/45">
          Choose which system capabilities are available to the default Chat
          Agent. All three are off by default.
        </p>
      </div>

      <div className="space-y-3">
        {accessOptions.map(
          ({ key, settingId, title, description, icon: Icon }) => {
            const enabled = access[key] === true;
            return (
              <div
                id={settingId}
                key={key}
                className="flex items-center justify-between gap-4 rounded-xl border border-cyan-400/15 bg-slate-950/35 px-4 py-3.5"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-cyan-400/15 bg-cyan-400/8 text-cyan-300">
                    <Icon className="size-4.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-cyan-50">
                      {title}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-cyan-100/45">
                      {description}
                    </p>
                    <span
                      className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium ${
                        enabled ? "text-emerald-300" : "text-cyan-100/35"
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          enabled ? "bg-emerald-400" : "bg-cyan-100/25"
                        }`}
                      />
                      {enabled ? "Available to Chat Agent" : "Not available"}
                    </span>
                  </div>
                </div>
                <Switch
                  aria-label={`Allow Chat Agent ${title.toLowerCase()}`}
                  checked={enabled}
                  onCheckedChange={(checked) =>
                    void updateSettings({
                      chatAgentSystemAccess: {
                        ...access,
                        [key]: checked,
                      },
                    })
                  }
                />
              </div>
            );
          },
        )}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-400/15 bg-amber-400/5 px-3 py-2.5 text-xs leading-5 text-amber-100/60">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300/70" />
        Terminal and Computer Use never bypass the confirmation prompt, even
        when their system-access switch is enabled.
      </div>
    </section>
  );
}
