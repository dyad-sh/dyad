import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import {
  AppWindow,
  Blocks,
  BookOpen,
  Database,
  FolderCog,
  Github,
  Home,
  MessageCircle,
  PlusCircle,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Store,
  Terminal,
  Wrench,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { selectedAppIdAtom, previewModeAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import {
  activeSettingsSectionAtom,
  isPreviewOpenAtom,
} from "@/atoms/viewAtoms";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useChats } from "@/hooks/useChats";
import { useSearchApps } from "@/hooks/useSearchApps";
import { useSearchChats } from "@/hooks/useSearchChats";
import { useSelectChat } from "@/hooks/useSelectChat";
import { useDebounce } from "@/hooks/useDebounce";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { SETTINGS_SEARCH_INDEX } from "@/lib/settingsSearchIndex";
import {
  parseCommandPaletteQuery,
  revealCommandPaletteTarget,
  scoreCommandPaletteItem,
} from "@/lib/commandPalette";
import type { ChatSearchResult } from "@/lib/schemas";
import { showError } from "@/lib/toast";

type CommandPaletteProps = {
  open: boolean;
  query: string;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
};

const APP_DETAIL_TARGETS = [
  {
    id: "manage-app",
    label: "Manage selected app",
    description: "Open app details and integrations",
    keywords: ["app settings", "details", "configuration"],
    targetId: "app-settings-overview",
    icon: FolderCog,
  },
  {
    id: "github",
    label: "Configure GitHub",
    description: "Connect the selected app to a GitHub repository",
    keywords: ["repository", "git", "source control"],
    targetId: "app-setting-github",
    icon: Github,
  },
  {
    id: "database",
    label: "Configure database integration",
    description: "Manage Supabase or Neon for the selected app",
    keywords: ["supabase", "neon", "postgres", "integration"],
    targetId: "app-setting-database",
    icon: Database,
  },
  {
    id: "mobile",
    label: "Configure mobile app",
    description: "Manage Capacitor configuration",
    keywords: ["capacitor", "ios", "android"],
    targetId: "app-setting-mobile",
    icon: Smartphone,
  },
  {
    id: "upgrades",
    label: "Manage app upgrades",
    description: "Review available app upgrades",
    keywords: ["upgrade", "update", "migration"],
    targetId: "app-setting-upgrades",
    icon: Wrench,
  },
] as const;

const CONFIGURE_TARGETS = [
  {
    id: "environment-variables",
    label: "Configure environment variables",
    description: "Manage local environment variables for the selected app",
    keywords: ["env", "secrets", "configuration"],
    targetId: "app-config-environment-variables",
    icon: SlidersHorizontal,
  },
  {
    id: "app-commands",
    label: "Configure app commands",
    description: "Set custom install and start commands",
    keywords: ["install", "start", "command", "npm", "pnpm"],
    targetId: "app-config-commands",
    icon: Terminal,
  },
] as const;

export function CommandPalette({
  open,
  query,
  onOpenChange,
  onQueryChange,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);
  const setActiveSettingsSection = useSetAtom(activeSettingsSectionAtom);
  const { apps } = useLoadApps();
  const { chats, invalidateChats } = useChats(selectedAppId);
  const { selectChat } = useSelectChat();
  const parsedQuery = useMemo(() => parseCommandPaletteQuery(query), [query]);
  const debouncedTerm = useDebounce(parsedQuery.term, 150);
  const { apps: searchedApps, loading: appsLoading } = useSearchApps(
    parsedQuery.scope === "all" ? debouncedTerm : "",
  );
  const { chats: searchedChats, loading: chatsLoading } = useSearchChats(
    selectedAppId,
    debouncedTerm,
  );
  const selectedApp = apps.find((app) => app.id === selectedAppId) ?? null;
  const chatResults = parsedQuery.term ? searchedChats : chats;
  const targetChat =
    chats.find((chat) => chat.id === selectedChatId) ?? chats[0] ?? null;

  const closeAndRun = (action: () => void | Promise<void>) => {
    onOpenChange(false);
    Promise.resolve(action()).catch(showError);
  };

  const navigateAndReveal = async (
    to: "/settings" | "/app-details",
    targetId: string,
    sectionId?: string,
  ) => {
    if (to === "/settings") {
      await navigate({ to });
      if (sectionId) setActiveSettingsSection(sectionId);
    } else if (selectedAppId) {
      await navigate({ to, search: { appId: selectedAppId } });
    }
    await revealCommandPaletteTarget(targetId);
  };

  const openConfigureTarget = async (targetId: string) => {
    if (!targetChat || !selectedAppId) return;
    selectChat({ chatId: targetChat.id, appId: selectedAppId });
    setIsPreviewOpen(true);
    setPreviewMode("configure");
    await revealCommandPaletteTarget(targetId);
  };

  const createChat = async () => {
    if (!selectedAppId) return;
    const chatId = await ipc.chat.createChat({ appId: selectedAppId });
    await invalidateChats();
    await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
    selectChat({ chatId, appId: selectedAppId });
  };

  const commandFilter = (value: string, _search: string, keywords?: string[]) =>
    scoreCommandPaletteItem(value, parsedQuery.term, keywords);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command Palette"
      description="Search Dyad commands, settings, apps, and chats"
      data-testid="command-palette"
      className="max-w-2xl"
      filter={commandFilter}
    >
      <CommandInput
        value={query}
        onValueChange={onQueryChange}
        placeholder="Search commands, settings, apps, and chats"
        aria-label="Command palette search"
        data-testid="command-palette-input"
      />
      <CommandList className="max-h-[min(420px,60vh)] scrollbar-on-hover">
        <CommandEmpty data-testid="command-palette-empty">
          {parsedQuery.scope === "chat" && !selectedAppId
            ? "Select an app to search chats"
            : appsLoading || chatsLoading
              ? "Searching..."
              : "No results found"}
        </CommandEmpty>

        {parsedQuery.scope === "all" && (
          <>
            <CommandGroup heading="Commands">
              <CommandItem
                value="Go to Apps home"
                keywords={["projects", "applications"]}
                onSelect={() => closeAndRun(() => navigate({ to: "/" }))}
              >
                <Home />
                <span>Go to Apps</span>
              </CommandItem>
              <CommandItem
                value="Go to Settings preferences configuration"
                keywords={["preferences", "configuration"]}
                onSelect={() =>
                  closeAndRun(() => navigate({ to: "/settings" }))
                }
              >
                <Settings />
                <span>Go to Settings</span>
              </CommandItem>
              <CommandItem
                value="Go to Library"
                onSelect={() => closeAndRun(() => navigate({ to: "/library" }))}
              >
                <BookOpen />
                <span>Go to Library</span>
              </CommandItem>
              <CommandItem
                value="Go to Templates"
                onSelect={() =>
                  closeAndRun(() => navigate({ to: "/templates" }))
                }
              >
                <Store />
                <span>Go to Templates</span>
              </CommandItem>
              <CommandItem
                value="Go to Plugins MCP"
                keywords={["mcp", "tools"]}
                onSelect={() => closeAndRun(() => navigate({ to: "/plugins" }))}
              >
                <Blocks />
                <span>Go to Plugins</span>
              </CommandItem>
              {selectedAppId && (
                <CommandItem
                  value={`New chat ${selectedApp?.name ?? "selected app"}`}
                  keywords={["conversation", "message"]}
                  onSelect={() => closeAndRun(createChat)}
                >
                  <PlusCircle />
                  <span>
                    New chat for {selectedApp?.name ?? "selected app"}
                  </span>
                </CommandItem>
              )}
            </CommandGroup>

            <CommandGroup heading="Settings">
              {SETTINGS_SEARCH_INDEX.map((setting) => (
                <CommandItem
                  key={setting.id}
                  value={`${setting.label} ${setting.description}`}
                  keywords={[...setting.keywords, setting.sectionLabel]}
                  data-testid={`command-palette-setting-${setting.id}`}
                  onSelect={() =>
                    closeAndRun(() =>
                      navigateAndReveal(
                        "/settings",
                        setting.id,
                        setting.sectionId,
                      ),
                    )
                  }
                >
                  <Settings />
                  <div className="min-w-0 flex-1">
                    <div>{setting.label}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {setting.sectionLabel} · {setting.description}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>

            {selectedAppId && (
              <CommandGroup
                heading={`Current App · ${selectedApp?.name ?? "App"}`}
              >
                {APP_DETAIL_TARGETS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={item.id}
                      value={`${item.label} ${item.description}`}
                      keywords={[...item.keywords]}
                      data-testid={`command-palette-app-setting-${item.id}`}
                      onSelect={() =>
                        closeAndRun(() =>
                          navigateAndReveal("/app-details", item.targetId),
                        )
                      }
                    >
                      <Icon />
                      <div className="min-w-0 flex-1">
                        <div>{item.label}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {item.description}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
                {targetChat &&
                  CONFIGURE_TARGETS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <CommandItem
                        key={item.id}
                        value={`${item.label} ${item.description}`}
                        keywords={[...item.keywords]}
                        data-testid={`command-palette-app-setting-${item.id}`}
                        onSelect={() =>
                          closeAndRun(() => openConfigureTarget(item.targetId))
                        }
                      >
                        <Icon />
                        <div className="min-w-0 flex-1">
                          <div>{item.label}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {item.description}
                          </div>
                        </div>
                      </CommandItem>
                    );
                  })}
              </CommandGroup>
            )}

            {parsedQuery.term && searchedApps.length > 0 && (
              <CommandGroup heading="Apps">
                {searchedApps.map((app) => (
                  <CommandItem
                    key={app.id}
                    value={`${app.name} ${app.matchedChatTitle ?? ""} ${app.matchedChatMessage ?? ""}`}
                    data-testid={`command-palette-app-${app.id}`}
                    onSelect={() =>
                      closeAndRun(() =>
                        navigate({
                          to: "/app-details",
                          search: { appId: app.id },
                        }),
                      )
                    }
                  >
                    <AppWindow />
                    <span className="truncate">{app.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}

        {(parsedQuery.scope === "chat" || parsedQuery.term) &&
          selectedAppId &&
          chatResults.length > 0 && (
            <CommandGroup heading="Chats">
              {chatResults.map((chat) => {
                const matchedContent =
                  "matchedMessageContent" in chat
                    ? (chat as ChatSearchResult).matchedMessageContent
                    : null;
                return (
                  <CommandItem
                    key={chat.id}
                    value={`${chat.title || "Untitled Chat"} ${matchedContent ?? ""}`}
                    data-testid={`command-palette-chat-${chat.id}`}
                    onSelect={() =>
                      closeAndRun(() =>
                        selectChat({ chatId: chat.id, appId: chat.appId }),
                      )
                    }
                  >
                    <MessageCircle />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        {chat.title || "Untitled Chat"}
                      </div>
                      {matchedContent && (
                        <div className="line-clamp-2 text-xs text-muted-foreground">
                          {matchedContent}
                        </div>
                      )}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
      </CommandList>
    </CommandDialog>
  );
}
