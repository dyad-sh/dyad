import "@xterm/xterm/css/xterm.css";

import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { RotateCcw, Search, X } from "lucide-react";
import { useAtom } from "jotai";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { terminalFontSizeAtom } from "@/atoms/terminalAtoms";
import { useReducedMotionPref } from "@/hooks/useReducedMotion";
import { useTerminalSession } from "@/hooks/useTerminalSession";
import { useTheme } from "@/contexts/ThemeContext";
import { ipc } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { showError } from "@/lib/toast";
import { StreamingLoadingAnimation } from "./StreamingLoadingAnimation";
import { TerminalEscapeBanner } from "./TerminalEscapeBanner";

type TerminalPanelSize = "full" | "split-bottom";

interface TerminalPanelProps {
  appId: number | null;
  chatId: number;
  appName?: string | null;
  onExit: () => void;
  fitSignal: number;
  size?: TerminalPanelSize;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;

function getTerminalTheme(isDarkMode: boolean) {
  if (isDarkMode) {
    return {
      background: "#111013",
      foreground: "#f5f3f7",
      cursor: "#c084fc",
      cursorAccent: "#111013",
      selectionBackground: "#7c3aed55",
      black: "#1f1f23",
      red: "#ef4444",
      green: "#22c55e",
      yellow: "#f59e0b",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#2dd4bf",
      white: "#e5e7eb",
      brightBlack: "#6b7280",
      brightRed: "#f87171",
      brightGreen: "#4ade80",
      brightYellow: "#fbbf24",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#5eead4",
      brightWhite: "#ffffff",
    };
  }

  return {
    background: "#ffffff",
    foreground: "#24212a",
    cursor: "#7c3aed",
    cursorAccent: "#ffffff",
    selectionBackground: "#a78bfa55",
    black: "#1f2937",
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#d97706",
    blue: "#2563eb",
    magenta: "#9333ea",
    cyan: "#0891b2",
    white: "#f8fafc",
    brightBlack: "#6b7280",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#f59e0b",
    brightBlue: "#3b82f6",
    brightMagenta: "#a855f7",
    brightCyan: "#06b6d4",
    brightWhite: "#ffffff",
  };
}

function clampFontSize(value: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value));
}

function EmptyTerminalState({
  title,
  description,
  cwd,
  onBack,
}: {
  title: string;
  description: string;
  cwd?: string;
  onBack: () => void;
}) {
  const { t } = useTranslation("chat");

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-lg rounded-2xl border bg-background p-5 text-center shadow-sm">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {cwd && (
          <code className="mt-3 block truncate rounded-md bg-muted px-2 py-1 text-xs">
            {cwd}
          </code>
        )}
        <div className="mt-4 flex justify-center gap-2">
          {cwd && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void ipc.system.showItemInFolder(cwd);
              }}
            >
              {t("terminal.revealFolder")}
            </Button>
          )}
          <Button type="button" onClick={onBack}>
            {t("terminal.backToChat")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function TerminalPanel({
  appId,
  chatId,
  appName,
  onExit,
  fitSignal,
  size = "full",
}: TerminalPanelProps) {
  const { t } = useTranslation("chat");
  const reducedMotion = useReducedMotionPref();
  const { isDarkMode } = useTheme();
  const [fontSize, setFontSize] = useAtom(terminalFontSizeAtom);
  const [terminalSize, setTerminalSize] = useState({
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [hasFitSignal, setHasFitSignal] = useState(false);
  const terminalTheme = useMemo(
    () => ({
      ...getTerminalTheme(isDarkMode),
      background: "rgba(0, 0, 0, 0)",
    }),
    [isDarkMode],
  );
  const terminalElementRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const initialFontSizeRef = useRef(fontSize);
  const initialThemeRef = useRef(terminalTheme);
  const writeRef = useRef<(data: string) => void>(() => {});
  const resizeRef = useRef<(cols: number, rows: number) => void>(() => {});

  const handleTerminalData = useCallback((chunk: string) => {
    terminalRef.current?.write(chunk);
  }, []);

  const { session, status, error, exit, write, resize, restart, kill } =
    useTerminalSession({
      appId,
      enabled: appId !== null,
      cols: terminalSize.cols,
      rows: terminalSize.rows,
      onData: handleTerminalData,
    });

  useEffect(() => {
    writeRef.current = write;
  }, [write]);

  useEffect(() => {
    resizeRef.current = resize;
  }, [resize]);

  useEffect(() => {
    if (fitSignal > 0) {
      setHasFitSignal(true);
    }
  }, [fitSignal]);

  const fitAndResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon || !hasFitSignal) return;

    const dimensions = fitAddon.proposeDimensions();
    if (!dimensions || dimensions.cols <= 0 || dimensions.rows <= 0) {
      return;
    }

    fitAddon.fit();
    const nextSize = {
      cols: terminal.cols,
      rows: terminal.rows,
    };
    setTerminalSize(nextSize);
    resizeRef.current(nextSize.cols, nextSize.rows);
  }, [hasFitSignal]);

  useEffect(() => {
    const element = terminalElementRef.current;
    if (!element || appId === null) return;

    const terminal = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      cursorBlink: true,
      fontFamily:
        '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: initialFontSizeRef.current,
      screenReaderMode: true,
      scrollback: 10_000,
      tabStopWidth: 8,
      theme: initialThemeRef.current,
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon({ highlightLimit: 1000 });
    const unicodeAddon = new Unicode11Addon();
    const clipboardAddon = new ClipboardAddon();
    const serializeAddon = new SerializeAddon();
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      void ipc.system.openExternalUrl(uri);
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(unicodeAddon);
    terminal.loadAddon(clipboardAddon);
    terminal.loadAddon(serializeAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.unicode.activeVersion = "11";
    terminal.open(element);
    terminal.focus();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    (window as any).__DYAD_TERMINAL__ = terminal;

    const dataDisposable = terminal.onData((data) => {
      writeRef.current(data);
    });
    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection) {
        void navigator.clipboard?.writeText(selection);
      }
    });

    return () => {
      dataDisposable.dispose();
      selectionDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
      if ((window as any).__DYAD_TERMINAL__ === terminal) {
        delete (window as any).__DYAD_TERMINAL__;
      }
    };
  }, [appId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = fontSize;
    requestAnimationFrame(fitAndResize);
  }, [fitAndResize, fontSize]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = terminalTheme;
  }, [terminalTheme]);

  useEffect(() => {
    if (!hasFitSignal) return;
    requestAnimationFrame(() => {
      fitAndResize();
      terminalRef.current?.focus();
    });
  }, [fitAndResize, fitSignal, hasFitSignal]);

  useEffect(() => {
    const element = terminalElementRef.current;
    if (!element || !hasFitSignal) return;

    let timeoutId: number | undefined;
    const observer = new ResizeObserver(() => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(() => {
        fitAndResize();
      }, 50);
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [fitAndResize, hasFitSignal]);

  useEffect(() => {
    if (!searchOpen || !searchQuery) return;
    searchAddonRef.current?.findNext(searchQuery, {
      incremental: true,
      decorations: {
        matchBackground: "#fde68a",
        matchOverviewRuler: "#f59e0b",
        activeMatchBackground: "#f59e0b",
        activeMatchColorOverviewRuler: "#d97706",
      },
    });
  }, [searchOpen, searchQuery]);

  const handleKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const isCommand = event.metaKey || event.ctrlKey;
      if (!isCommand) return;

      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        event.stopPropagation();
        onExit();
        return;
      }

      if (key === "f") {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(true);
        return;
      }

      if (key === "+" || key === "=") {
        event.preventDefault();
        setFontSize((current) => clampFontSize(current + 1));
        return;
      }

      if (key === "-") {
        event.preventDefault();
        setFontSize((current) => clampFontSize(current - 1));
        return;
      }

      if (key === "0") {
        event.preventDefault();
        setFontSize(14);
      }
    },
    [onExit, setFontSize],
  );

  const handleCopy = useCallback(() => {
    const selection = terminalRef.current?.getSelection();
    if (!selection) return;
    void navigator.clipboard?.writeText(selection);
  }, []);

  const handlePaste = useCallback(() => {
    void navigator.clipboard
      ?.readText()
      .then((text) => {
        if (text) {
          writeRef.current(text);
        }
      })
      .catch((err) => showError(err));
  }, []);

  const appLabel = session?.appName ?? appName ?? t("terminal.thisApp");
  const cwd = session?.cwd;
  const showLoading = status === "connecting" || status === "idle";

  if (appId === null) {
    return (
      <div className="flex h-full flex-col bg-background">
        <TerminalEscapeBanner appName={appLabel} onExit={onExit} />
        <EmptyTerminalState
          title={t("terminal.noAppTitle")}
          description={t("terminal.noAppDescription")}
          onBack={onExit}
        />
      </div>
    );
  }

  return (
    <div
      data-chat-id={chatId}
      className={cn(
        "flex h-full min-h-0 flex-col bg-background",
        size === "split-bottom" && "border-t",
      )}
      onKeyDownCapture={handleKeyDownCapture}
    >
      <TerminalEscapeBanner appName={appLabel} cwd={cwd} onExit={onExit} />
      <div className="sr-only" aria-live="polite">
        {status === "ready"
          ? t("terminal.screenReaderOpened", { appName: appLabel, cwd })
          : ""}
      </div>
      <div className="relative min-h-0 flex-1">
        <ContextMenu>
          <ContextMenuTrigger className="block h-full min-h-0">
            <div className="box-border h-full bg-background p-2">
              <div className="box-border h-full overflow-hidden bg-background p-2">
                <div
                  ref={terminalElementRef}
                  role="application"
                  aria-label={t("terminal.ariaLabel", { appName: appLabel })}
                  data-testid="terminal-xterm"
                  className="h-full min-h-0 overflow-hidden bg-background [&_.xterm-rows]:!bg-background [&_.xterm-screen]:!bg-background [&_.xterm-viewport]:!bg-background [&_.xterm-viewport]:scrollbar-on-hover [&_.xterm]:!bg-background [&_.xterm]:h-full"
                />
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={handleCopy}>
              {t("terminal.context.copy")}
            </ContextMenuItem>
            <ContextMenuItem onClick={handlePaste}>
              {t("terminal.context.paste")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => terminalRef.current?.clear()}>
              {t("terminal.context.clear")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => {
                terminalRef.current?.clear();
                restart();
              }}
            >
              {t("terminal.context.restart")}
            </ContextMenuItem>
            <ContextMenuItem onClick={onExit}>
              {t("terminal.context.exit")}
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onClick={kill}>
              {t("terminal.context.kill")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {showLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/95">
            {reducedMotion ? (
              <span className="text-sm text-muted-foreground">
                {t("terminal.loading")}
              </span>
            ) : (
              <StreamingLoadingAnimation variant="initial" />
            )}
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 bg-background/95">
            <EmptyTerminalState
              title={t("terminal.errorTitle")}
              description={error ?? t("terminal.errorDescription")}
              cwd={cwd}
              onBack={onExit}
            />
          </div>
        )}

        {status === "exited" && (
          <div className="absolute inset-x-0 bottom-0 border-t bg-background/95 p-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                {exit?.exitCode === null
                  ? t("terminal.exitedUnknown")
                  : t("terminal.exitedWithCode", { code: exit?.exitCode })}
              </span>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  terminalRef.current?.clear();
                  restart();
                }}
              >
                <RotateCcw className="mr-1.5 size-3.5" />
                {t("terminal.restartShell")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onExit}
              >
                {t("terminal.backToChat")}
              </Button>
            </div>
          </div>
        )}

        {searchOpen && (
          <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md border bg-popover p-1 shadow-md">
            <Search className="ml-1 size-4 text-muted-foreground" />
            <input
              autoFocus
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (event.shiftKey) {
                    searchAddonRef.current?.findPrevious(searchQuery);
                  } else {
                    searchAddonRef.current?.findNext(searchQuery);
                  }
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSearchOpen(false);
                  terminalRef.current?.focus();
                }
              }}
              className="h-7 w-48 bg-transparent px-1 text-sm outline-none"
              placeholder={t("terminal.searchPlaceholder")}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => {
                setSearchOpen(false);
                terminalRef.current?.focus();
              }}
              aria-label={t("terminal.closeSearch")}
            >
              <X className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
