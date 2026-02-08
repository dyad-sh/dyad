import { useCallback, useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { isTerminalOpenAtom, terminalHeightAtom } from "@/atoms/viewAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { ipc, type TerminalOutput, type TerminalSession } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Terminal,
  X,
  Maximize2,
  Minimize2,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface TerminalLine {
  id: string;
  content: string;
  type: "stdout" | "stderr" | "system" | "input";
  timestamp: number;
}

const MIN_HEIGHT = 150;
const MAX_HEIGHT = 600;

export function TerminalDrawer() {
  const [isOpen, setIsOpen] = useAtom(isTerminalOpenAtom);
  const [height, setHeight] = useAtom(terminalHeightAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);

  const [session, setSession] = useState<TerminalSession | null>(null);
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);
  const lineIdCounter = useRef(0);

  // Auto-scroll to bottom when new lines are added
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  // Subscribe to terminal output events
  useEffect(() => {
    const unsubscribeOutput = ipc.events.terminal.onOutput(
      (payload: TerminalOutput) => {
        if (session && payload.sessionId === session.id) {
          const newLine: TerminalLine = {
            id: `line-${lineIdCounter.current++}`,
            content: payload.data,
            type: payload.type,
            timestamp: Date.now(),
          };
          setLines((prev) => [...prev, newLine]);
        }
      },
    );

    const unsubscribeClose = ipc.events.terminal.onSessionClosed(
      (payload: { sessionId: string }) => {
        if (session && payload.sessionId === session.id) {
          setSession(null);
          const newLine: TerminalLine = {
            id: `line-${lineIdCounter.current++}`,
            content: "\r\n[Session ended]\r\n",
            type: "system",
            timestamp: Date.now(),
          };
          setLines((prev) => [...prev, newLine]);
        }
      },
    );

    return () => {
      unsubscribeOutput();
      unsubscribeClose();
    };
  }, [session]);

  // Create a new terminal session
  const createSession = useCallback(async () => {
    if (!selectedAppId || isConnecting) return;

    setIsConnecting(true);
    setLines([]);

    try {
      const newSession = await ipc.terminal.createSession({
        appId: selectedAppId,
      });
      setSession(newSession);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create session";
      const errorLine: TerminalLine = {
        id: `line-${lineIdCounter.current++}`,
        content: `\x1b[31mError: ${errorMessage}\x1b[0m\r\n`,
        type: "system",
        timestamp: Date.now(),
      };
      setLines([errorLine]);
    } finally {
      setIsConnecting(false);
    }
  }, [selectedAppId, isConnecting]);

  // Close the current session
  const closeSession = useCallback(async () => {
    if (!session) return;

    try {
      await ipc.terminal.close({ sessionId: session.id });
    } catch {
      // Ignore errors when closing
    }
    setSession(null);
  }, [session]);

  // Handle input submission
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!session || !inputValue.trim()) return;

      // Add input to display
      const inputLine: TerminalLine = {
        id: `line-${lineIdCounter.current++}`,
        content: `$ ${inputValue}\r\n`,
        type: "input",
        timestamp: Date.now(),
      };
      setLines((prev) => [...prev, inputLine]);

      // Send command to terminal
      try {
        await ipc.terminal.write({
          sessionId: session.id,
          data: inputValue + "\n",
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to send command";
        const errorLine: TerminalLine = {
          id: `line-${lineIdCounter.current++}`,
          content: `\x1b[31mError: ${errorMessage}\x1b[0m\r\n`,
          type: "system",
          timestamp: Date.now(),
        };
        setLines((prev) => [...prev, errorLine]);
      }

      setInputValue("");
    },
    [session, inputValue],
  );

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "c" && e.ctrlKey) {
        // Send SIGINT
        if (session) {
          ipc.terminal.write({ sessionId: session.id, data: "\x03" });
        }
      } else if (e.key === "l" && e.ctrlKey) {
        // Clear screen
        e.preventDefault();
        setLines([]);
      }
    },
    [session],
  );

  // Handle resize drag
  useEffect(() => {
    const resizeHandle = resizeRef.current;
    if (!resizeHandle) return;

    let startY = 0;
    let startHeight = 0;

    const handleMouseDown = (e: MouseEvent) => {
      startY = e.clientY;
      startHeight = height;
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    };

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startY - e.clientY;
      const newHeight = Math.min(
        MAX_HEIGHT,
        Math.max(MIN_HEIGHT, startHeight + delta),
      );
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    resizeHandle.addEventListener("mousedown", handleMouseDown);
    return () => {
      resizeHandle.removeEventListener("mousedown", handleMouseDown);
    };
  }, [height, setHeight]);

  // Focus input when terminal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Auto-create session when opening with an app selected
  useEffect(() => {
    if (isOpen && selectedAppId && !session && !isConnecting) {
      createSession();
    }
  }, [isOpen, selectedAppId, session, isConnecting, createSession]);

  // Clean up session when app changes
  useEffect(() => {
    if (session && selectedAppId !== session.appId) {
      closeSession();
    }
  }, [selectedAppId, session, closeSession]);

  if (!isOpen) return null;

  const displayHeight = isMaximized ? MAX_HEIGHT : height;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-[#1e1e1e] border-t border-gray-700 shadow-2xl"
      style={{ height: displayHeight }}
    >
      {/* Resize handle */}
      <div
        ref={resizeRef}
        className="h-1 w-full cursor-row-resize bg-gray-700 hover:bg-blue-500 transition-colors flex-shrink-0"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#252526] border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="size-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-200">Terminal</span>
          {session && (
            <span className="text-xs text-gray-500 truncate max-w-[200px]">
              {session.cwd}
            </span>
          )}
          {isConnecting && (
            <span className="text-xs text-yellow-500 animate-pulse">
              Connecting...
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* New session button */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
            onClick={createSession}
            disabled={!selectedAppId || isConnecting}
            title="New terminal session"
          >
            <Plus className="size-4" />
          </Button>

          {/* Clear button */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
            onClick={() => setLines([])}
            title="Clear terminal (Ctrl+L)"
          >
            <Trash2 className="size-4" />
          </Button>

          {/* Maximize/Minimize */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
            onClick={() => setIsMaximized(!isMaximized)}
            title={isMaximized ? "Restore size" : "Maximize"}
          >
            {isMaximized ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>

          {/* Collapse */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
            onClick={() => setIsOpen(false)}
            title="Close terminal"
          >
            <ChevronDown className="size-4" />
          </Button>

          {/* Close */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-gray-400 hover:text-red-400 hover:bg-gray-700"
            onClick={() => {
              closeSession();
              setIsOpen(false);
            }}
            title="Close and end session"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Terminal content */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-y-auto overflow-x-hidden p-2 font-mono text-sm leading-relaxed"
        onClick={() => inputRef.current?.focus()}
      >
        {!selectedAppId ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <p>Select an app to use the terminal</p>
          </div>
        ) : lines.length === 0 && !isConnecting ? (
          <div className="text-gray-500 text-xs">
            <p>Terminal ready. Type a command and press Enter.</p>
            <p className="mt-1 text-gray-600">
              Tips: Ctrl+C to interrupt, Ctrl+L to clear
            </p>
          </div>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className={cn(
                "whitespace-pre-wrap break-all",
                line.type === "stderr" && "text-red-400",
                line.type === "system" && "text-gray-500",
                line.type === "input" && "text-green-400",
                line.type === "stdout" && "text-gray-200",
              )}
              // Handle ANSI escape codes by using dangerouslySetInnerHTML
              // For now, we strip them for simplicity
            >
              {stripAnsiCodes(line.content)}
            </div>
          ))
        )}
      </div>

      {/* Input line */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-2 py-1.5 bg-[#1e1e1e] border-t border-gray-700 flex-shrink-0"
      >
        <span className="text-green-400 font-mono text-sm">$</span>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            !session
              ? "Waiting for session..."
              : "Type a command and press Enter"
          }
          disabled={!session}
          className="flex-1 bg-transparent text-gray-200 font-mono text-sm outline-none placeholder:text-gray-600 disabled:opacity-50"
          autoComplete="off"
          spellCheck={false}
        />
      </form>
    </div>
  );
}

/**
 * Strip ANSI escape codes from terminal output
 * This is a simple implementation - a full solution would parse and render them
 */
function stripAnsiCodes(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

/**
 * Terminal toggle button for the toolbar
 */
export function TerminalToggleButton() {
  const [isOpen, setIsOpen] = useAtom(isTerminalOpenAtom);

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-8", isOpen && "bg-accent text-accent-foreground")}
      onClick={() => setIsOpen(!isOpen)}
      title={isOpen ? "Close terminal" : "Open terminal"}
    >
      {isOpen ? (
        <ChevronDown className="size-4" />
      ) : (
        <ChevronUp className="size-4" />
      )}
      <Terminal className="size-4" />
    </Button>
  );
}
