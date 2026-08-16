import {
  Globe2,
  MousePointer2,
  SearchX,
  ShieldAlert,
  Terminal,
} from "lucide-react";
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

export function ChatAgentSystemAccessSettings({
  embedded = false,
  searchQuery = "",
}: {
  embedded?: boolean;
  searchQuery?: string;
} = {}) {
  const { settings, updateSettings } = useSettings();
  const access = settings?.chatAgentSystemAccess ?? {};
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleOptions = accessOptions.filter(
    ({ title, description }) =>
      normalizedQuery.length === 0 ||
      title.toLowerCase().includes(normalizedQuery) ||
      description.toLowerCase().includes(normalizedQuery),
  );

  return (
    <section
      id={SECTION_IDS.systemAccess}
      className={
        embedded
          ? "scroll-mt-24"
          : "scroll-mt-24 rounded-2xl border border-border/70 bg-card/90 p-6 shadow-sm backdrop-blur-md"
      }
    >
      {!embedded && (
        <div className="mb-5">
          <h2 className="font-jarvis-ui text-sm font-medium uppercase tracking-widest text-primary">
            Agent skills
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose which built-in capabilities are available to the default Chat
            Agent. All three are off by default.
          </p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {visibleOptions.map(
          ({ key, settingId, title, description, icon: Icon }) => {
            const enabled = access[key] === true;
            return (
              <div
                id={settingId}
                key={key}
                className="group flex min-h-32 items-start justify-between gap-4 rounded-xl border border-border/70 bg-background/45 px-4 py-4 shadow-sm transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-md"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/8 text-primary transition-colors group-hover:bg-primary/12">
                    <Icon className="size-4.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      {title}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {description}
                    </p>
                    <span
                      className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium ${
                        enabled ? "text-emerald-500" : "text-muted-foreground"
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          enabled ? "bg-emerald-500" : "bg-muted-foreground/35"
                        }`}
                      />
                      {enabled ? "Available to Chat Agent" : "Not available"}
                    </span>
                  </div>
                </div>
                <Switch
                  className="mt-1 shrink-0"
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

      {visibleOptions.length === 0 && (
        <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-border bg-muted/20 px-6 text-center">
          <div>
            <SearchX className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">
              No skills found
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try searching for terminal, browser or computer.
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/8 px-3.5 py-3 text-xs leading-5 text-amber-700 dark:text-amber-200/80">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
        Terminal and Computer Use never bypass the confirmation prompt, even
        when their system-access switch is enabled.
      </div>
    </section>
  );
}
