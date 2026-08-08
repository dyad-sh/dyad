import { useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  Bot,
  Clock,
  HelpCircle,
  LayoutGrid,
  MessageSquare,
  Monitor,
  Palette,
  Pin,
  PinOff,
  Search,
  Settings as SettingsIcon,
  Star,
} from "lucide-react";

import { chatAgentHistoryAtom } from "@/atoms/chatAgentAtoms";
import { desktopDockPinsAtom, desktopModeAtom } from "@/atoms/desktopAtoms";
import {
  DESKTOP_APP_CATEGORIES,
  DESKTOP_APPS,
  searchDesktopApps,
  type DesktopApp,
} from "@/lib/desktop/desktop_apps";
import { useTheme } from "@/contexts/ThemeContext";
import { UI_THEMES } from "@/lib/ui_themes";
import { cn } from "@/lib/utils";
import { HelpDialog } from "@/components/HelpDialog";

type Section = "home" | "all" | "favourites" | "recent" | (string & {});

/**
 * The Meta Human start menu: categories on the left, apps and recent work in
 * the middle, identity and system actions along the bottom.
 *
 * Everything listed is a real feature or a real conversation — nothing is
 * shown that cannot be opened.
 */
export function StartMenu({
  open,
  onClose,
  onOpenApp,
  onOpenConversation,
  recentAppIds,
}: {
  open: boolean;
  onClose: () => void;
  onOpenApp: (appId: string) => void;
  onOpenConversation: (conversationId: string) => void;
  recentAppIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<Section>("home");
  const [pins, setPins] = useAtom(desktopDockPinsAtom);
  const history = useAtomValue(chatAgentHistoryAtom);
  const setDesktopMode = useSetAtom(desktopModeAtom);
  const { theme } = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);
  const [highlight, setHighlight] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSection("home");
      setHighlight(0);
      // Typing should go straight to search the moment the menu appears.
      searchRef.current?.focus();
    }
  }, [open]);

  const searching = query.trim().length > 0;
  const results = useMemo(() => searchDesktopApps(query), [query]);

  const sectionApps = useMemo((): DesktopApp[] => {
    if (searching) return results;
    switch (section) {
      case "home":
        return DESKTOP_APPS.filter((app) => pins.includes(app.id));
      case "all":
        return DESKTOP_APPS;
      case "favourites":
        return DESKTOP_APPS.filter((app) => pins.includes(app.id));
      case "recent":
        return recentAppIds
          .map((id) => DESKTOP_APPS.find((app) => app.id === id))
          .filter((app): app is DesktopApp => Boolean(app));
      default:
        return DESKTOP_APPS.filter((app) => app.category === section);
    }
  }, [pins, recentAppIds, results, searching, section]);

  const recentConversations = useMemo(() => history.slice(0, 5), [history]);

  const togglePin = (appId: string) => {
    setPins((current) =>
      current.includes(appId)
        ? current.filter((id) => id !== appId)
        : [...current, appId],
    );
  };

  const activeTheme = UI_THEMES.find((entry) => entry.id === theme);

  // Arrow keys move through results; Enter launches the highlighted one.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (sectionApps.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      setHighlight((index) => (index + 1) % sectionApps.length);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      setHighlight(
        (index) => (index - 1 + sectionApps.length) % sectionApps.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const app = sectionApps[highlight];
      if (app) onOpenApp(app.id);
    }
  };

  if (!open) return null;

  const navItems: { id: Section; label: string; icon: typeof Bot }[] = [
    { id: "home", label: "Home", icon: LayoutGrid },
    { id: "all", label: "All Applications", icon: LayoutGrid },
    { id: "favourites", label: "Favourites", icon: Star },
    { id: "recent", label: "Recent", icon: Clock },
    ...DESKTOP_APP_CATEGORIES.map((category) => ({
      id: category as Section,
      label: category,
      icon: Bot,
    })),
  ];

  return (
    <div className="desktop-start-backdrop" onClick={onClose}>
      <div
        className="desktop-start"
        role="dialog"
        aria-label="Meta Human start menu"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        data-testid="desktop-start-menu"
      >
        {/* Left navigation */}
        <nav className="desktop-start-nav" aria-label="Categories">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "desktop-start-nav-item",
                section === item.id && !searching && "is-active",
              )}
              onClick={() => {
                setSection(item.id);
                setQuery("");
                setHighlight(0);
              }}
            >
              <item.icon className="size-3.5 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Main area */}
        <div className="desktop-start-main">
          <div className="desktop-start-search">
            <Search className="size-4 opacity-60" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
              }}
              placeholder="Search applications and conversations…"
              aria-label="Search"
              data-testid="start-menu-search"
            />
          </div>

          <div className="desktop-start-scroll">
            <section>
              <h3 className="desktop-start-heading">
                {searching ? "Results" : sectionLabel(section, navItems)}
              </h3>
              <div className="desktop-start-grid">
                {sectionApps.map((app, index) => (
                  <div key={app.id} className="desktop-start-app-wrap">
                    <button
                      type="button"
                      className={cn(
                        "desktop-start-app",
                        index === highlight && "is-highlighted",
                      )}
                      onClick={() => onOpenApp(app.id)}
                      data-testid={`start-app-${app.id}`}
                    >
                      <span className="desktop-start-app-icon">
                        <app.icon className="size-5" />
                      </span>
                      <span className="truncate">{app.title}</span>
                    </button>
                    <button
                      type="button"
                      className="desktop-start-pin"
                      aria-label={
                        pins.includes(app.id)
                          ? `Unpin ${app.title}`
                          : `Pin ${app.title}`
                      }
                      onClick={() => togglePin(app.id)}
                    >
                      {pins.includes(app.id) ? (
                        <PinOff className="size-3" />
                      ) : (
                        <Pin className="size-3" />
                      )}
                    </button>
                  </div>
                ))}
                {sectionApps.length === 0 && (
                  <p className="desktop-start-empty">
                    {searching
                      ? `Nothing matches “${query}”.`
                      : "Nothing here yet."}
                  </p>
                )}
              </div>
            </section>

            {!searching && recentConversations.length > 0 && (
              <section>
                <h3 className="desktop-start-heading">Recent conversations</h3>
                <div className="desktop-start-list">
                  {recentConversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      className="desktop-start-row"
                      onClick={() => onOpenConversation(conversation.id)}
                      data-testid={`start-conversation-${conversation.id}`}
                    >
                      <MessageSquare className="size-3.5 shrink-0 opacity-60" />
                      <span className="truncate">
                        {conversation.title || "New conversation"}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        {/* User and system area */}
        <footer className="desktop-start-footer">
          <span className="desktop-start-identity">
            <Bot className="size-4" />
            <span>Meta Human OS</span>
          </span>
          <span className="desktop-start-meta">
            <Palette className="size-3.5" />
            {activeTheme?.label ?? "System theme"}
          </span>
          <div className="desktop-start-footer-actions">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="desktop-start-action"
            >
              <HelpCircle className="size-3.5" />
              Help
            </button>
            <button
              type="button"
              onClick={() => onOpenApp("settings")}
              className="desktop-start-action"
            >
              <SettingsIcon className="size-3.5" />
              Settings
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                setDesktopMode(false);
              }}
              className="desktop-start-action"
              data-testid="start-exit-desktop"
            >
              <Monitor className="size-3.5" />
              Exit Desktop
            </button>
          </div>
        </footer>
        <HelpDialog isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    </div>
  );
}

function sectionLabel(
  section: Section,
  items: { id: Section; label: string }[],
): string {
  return items.find((item) => item.id === section)?.label ?? "Applications";
}
