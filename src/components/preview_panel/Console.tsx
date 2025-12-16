import { appLogsAtom, appOutputAtom, envVarsAtom } from "@/atoms/appAtoms";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState, useMemo } from "react";
import { List, useDynamicRowHeight, useListRef } from "react-window";
import type { RowComponentProps } from "react-window";
import { LogEntryComponent } from "./LogEntry";
import { ConsoleFilters } from "./ConsoleFilters";

// Type for combined log entries
type CombinedLogEntry =
  | {
      entryType: "output";
      data: {
        type: string;
        timestamp: number;
        message: string;
      };
    }
  | {
      entryType: "log";
      data: {
        level: string;
        timestamp: number;
        message: string;
        sourceName?: string;
        type?: string;
      };
    };

// Console component
export const Console = () => {
  const appLogs = useAtomValue(appLogsAtom);
  const appOutput = useAtomValue(appOutputAtom);
  const envVars = useAtomValue(envVarsAtom);
  const listRef = useListRef(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);
  const hasScrolledToBottom = useRef(false);
  const [showFilters, setShowFilters] = useState(false);
  const [containerHeight, setContainerHeight] = useState(0);

  // Filter states
  const [levelFilter, setLevelFilter] = useState<
    "all" | "info" | "warn" | "error"
  >("all");
  const [typeFilter, setTypeFilter] = useState<
    "all" | "server" | "client" | "edge-function"
  >("all");
  const [sourceFilter, setSourceFilter] = useState<string>("");

  // Track container height for responsive filter visibility
  const prevContainerHeight = useRef(0);
  useEffect(() => {
    const container = containerRef.current?.parentElement;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;
        const wasZero = prevContainerHeight.current === 0;
        prevContainerHeight.current = newHeight;
        setContainerHeight(newHeight);
        // Reset scroll flag when container becomes visible (height goes from 0 to > 0)
        // This handles the case when console panel is opened
        if (wasZero && newHeight > 0) {
          hasScrolledToBottom.current = false;
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Show filters after initial render and when panel is large enough
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowFilters(containerHeight > 150);
    }, 300);
    return () => clearTimeout(timer);
  }, [containerHeight]);

  // Get unique source names for filter dropdown
  const uniqueSources = useMemo(() => {
    const sources = new Set<string>();
    appLogs.forEach((log) => {
      if (log.sourceName) sources.add(log.sourceName);
    });
    return Array.from(sources).sort();
  }, [appLogs]);

  // Filter logs
  const filteredLogs = useMemo(() => {
    return appLogs.filter((log) => {
      if (levelFilter !== "all" && log.level !== levelFilter) return false;
      if (typeFilter !== "all" && log.type !== typeFilter) return false;
      if (
        sourceFilter &&
        sourceFilter !== "all" &&
        log.sourceName !== sourceFilter
      )
        return false;
      return true;
    });
  }, [appLogs, levelFilter, typeFilter, sourceFilter]);

  // Filter appOutput
  const filteredOutput = useMemo(() => {
    return appOutput.filter((output) => {
      // Apply source filter - appOutput doesn't have sourceName, so always exclude when filter is active
      if (sourceFilter && sourceFilter !== "all") {
        return false;
      }

      // Apply level filter
      if (levelFilter === "error") {
        return output.type === "stderr" || output.type === "client-error";
      }
      if (levelFilter === "warn") {
        return false; // No warn level for appOutput
      }
      if (levelFilter === "info") {
        return (
          output.type === "stdout" ||
          output.type === "info" ||
          output.type === "input-requested"
        );
      }

      // Apply type filter if applicable
      if (typeFilter === "client") {
        return output.type === "client-error";
      }
      if (typeFilter === "server") {
        return output.type === "stdout" || output.type === "stderr";
      }
      if (typeFilter === "edge-function") {
        return false; // appOutput doesn't have edge function logs
      }

      return true;
    });
  }, [appOutput, levelFilter, typeFilter, sourceFilter]);

  // Combine and sort all entries by timestamp
  const combinedEntries = useMemo<CombinedLogEntry[]>(() => {
    const entries: CombinedLogEntry[] = [
      ...filteredOutput.map((output) => ({
        entryType: "output" as const,
        data: output,
      })),
      ...filteredLogs.map((log) => ({
        entryType: "log" as const,
        data: log,
      })),
    ];

    // Sort by timestamp
    return entries.sort((a, b) => a.data.timestamp - b.data.timestamp);
  }, [filteredOutput, filteredLogs]);

  // Use dynamic row height hook
  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: 24,
    key: "console-log-entries",
  });

  // Track if user is near bottom for auto-scroll
  const [isNearBottom, setIsNearBottom] = useState(true);
  const lastScrollTop = useRef(0);

  // Helper function to check if near bottom
  const checkNearBottom = (element: HTMLElement) => {
    const { scrollTop, scrollHeight, clientHeight } = element;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    // Consider "near bottom" if within 100px
    return distanceFromBottom < 100;
  };

  // Monitor scroll position to determine if user is near bottom
  useEffect(() => {
    const listElement = listRef.current?.element;
    if (!listElement) return;

    // Initialize isNearBottom based on current scroll position
    setIsNearBottom(checkNearBottom(listElement));

    const handleScroll = () => {
      const nearBottom = checkNearBottom(listElement);
      setIsNearBottom(nearBottom);
      lastScrollTop.current = listElement.scrollTop;
    };

    listElement.addEventListener("scroll", handleScroll);
    return () => listElement.removeEventListener("scroll", handleScroll);
  }, [listRef]);

  // Auto-scroll to bottom when new logs arrive (if first render or user is near bottom)
  useEffect(() => {
    if (combinedEntries.length > 0 && containerHeight > 0) {
      const listElement = listRef.current?.element;

      // If this is the first render or we haven't scrolled to bottom yet, always scroll to bottom
      // This handles the case when the console panel opens with existing logs
      if (isFirstRender.current || !hasScrolledToBottom.current) {
        // Use requestAnimationFrame to ensure the list is fully rendered
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            listRef.current?.scrollToRow({
              index: combinedEntries.length - 1,
              align: "end",
            });
            hasScrolledToBottom.current = true;
            // Update isNearBottom after scrolling
            if (listElement) {
              setIsNearBottom(checkNearBottom(listElement));
            }
          });
        });
        isFirstRender.current = false;
        return;
      }

      // For subsequent renders, only scroll if user is near bottom
      if (isNearBottom && listElement) {
        listRef.current?.scrollToRow({
          index: combinedEntries.length - 1,
          align: "end",
        });
      }
    }
  }, [combinedEntries, listRef, isNearBottom, containerHeight]);

  const handleClearFilters = () => {
    setLevelFilter("all");
    setTypeFilter("all");
    setSourceFilter("");
  };

  // Row renderer component
  const RowComponent = ({ index, style }: RowComponentProps) => {
    const entry = combinedEntries[index];
    if (!entry) {
      return <div style={style} />;
    }

    if (entry.entryType === "output") {
      return (
        <div style={style}>
          <LogEntryComponent
            type="output"
            outputType={
              entry.data.type as
                | "stdout"
                | "stderr"
                | "info"
                | "client-error"
                | "input-requested"
            }
            timestamp={entry.data.timestamp}
            message={entry.data.message}
          />
        </div>
      );
    } else {
      return (
        <div style={style}>
          <LogEntryComponent
            type="log"
            level={entry.data.level as "info" | "error" | "warn"}
            timestamp={entry.data.timestamp}
            message={entry.data.message}
            sourceName={entry.data.sourceName}
          />
        </div>
      );
    }
  };

  const listHeight = containerHeight - (showFilters ? 60 : 0);

  // Disable virtualization in test mode for easier e2e testing
  // E2E_TEST_BUILD is passed from main process via IPC (envVarsAtom)
  const isTestMode = envVars.E2E_TEST_BUILD === "true";

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Filter bar */}
      <ConsoleFilters
        levelFilter={levelFilter}
        typeFilter={typeFilter}
        sourceFilter={sourceFilter}
        onLevelFilterChange={setLevelFilter}
        onTypeFilterChange={setTypeFilter}
        onSourceFilterChange={setSourceFilter}
        onClearFilters={handleClearFilters}
        uniqueSources={uniqueSources}
        totalLogs={filteredLogs.length + filteredOutput.length}
        showFilters={showFilters}
      />

      {/* Virtualized log area */}
      <div ref={containerRef} className="flex-1 overflow-hidden px-4">
        {containerHeight > 0 &&
          (isTestMode ? (
            // Non-virtualized rendering for test mode - all logs visible in DOM
            <div
              className="font-mono text-xs"
              style={{ height: listHeight, overflowY: "auto" }}
            >
              {combinedEntries.map((entry, index) => {
                if (entry.entryType === "output") {
                  return (
                    <div key={index}>
                      <LogEntryComponent
                        type="output"
                        outputType={
                          entry.data.type as
                            | "stdout"
                            | "stderr"
                            | "info"
                            | "client-error"
                            | "input-requested"
                        }
                        timestamp={entry.data.timestamp}
                        message={entry.data.message}
                      />
                    </div>
                  );
                } else {
                  return (
                    <div key={index}>
                      <LogEntryComponent
                        type="log"
                        level={entry.data.level as "info" | "error" | "warn"}
                        timestamp={entry.data.timestamp}
                        message={entry.data.message}
                        sourceName={entry.data.sourceName}
                      />
                    </div>
                  );
                }
              })}
            </div>
          ) : (
            <List
              listRef={listRef}
              rowCount={combinedEntries.length}
              rowHeight={dynamicRowHeight}
              rowComponent={RowComponent}
              rowProps={{}}
              className="font-mono text-xs"
              defaultHeight={listHeight}
            />
          ))}
      </div>
    </div>
  );
};
