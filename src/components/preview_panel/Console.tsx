import { appConsoleEntriesAtom, envVarsAtom } from "@/atoms/appAtoms";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState, useMemo } from "react";
import { List, useDynamicRowHeight, useListRef } from "react-window";
import type { RowComponentProps } from "react-window";
import { ConsoleEntryComponent } from "./ConsoleEntry";
import { ConsoleFilters } from "./ConsoleFilters";

// Console component
export const Console = () => {
  const consoleEntries = useAtomValue(appConsoleEntriesAtom);
  const envVars = useAtomValue(envVarsAtom);
  const listRef = useListRef(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);
  const hasScrolledToBottom = useRef(false);
  const [showFilters, setShowFilters] = useState(false);
  const [containerHeight, setContainerHeight] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(
    new Set(),
  );
  const [listVersion, setListVersion] = useState(0);

  // Filter states
  const [levelFilter, setLevelFilter] = useState<
    "all" | "info" | "warn" | "error"
  >("all");
  const [typeFilter, setTypeFilter] = useState<
    | "all"
    | "server"
    | "client"
    | "edge-function"
    | "network-requests"
    | "build-time"
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
        const newWidth = entry.contentRect.width;
        const wasZero = prevContainerHeight.current === 0;
        prevContainerHeight.current = newHeight;
        setContainerHeight(newHeight);
        setContainerWidth(newWidth);
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
    consoleEntries.forEach((entry) => {
      if (entry.sourceName) sources.add(entry.sourceName);
    });
    return Array.from(sources).sort();
  }, [consoleEntries]);

  // Filter console entries
  const filteredEntries = useMemo(() => {
    return consoleEntries.filter((entry) => {
      if (levelFilter !== "all" && entry.level !== levelFilter) return false;
      if (typeFilter !== "all" && entry.type !== typeFilter) return false;
      if (
        sourceFilter &&
        sourceFilter !== "all" &&
        entry.sourceName !== sourceFilter
      )
        return false;
      return true;
    });
  }, [consoleEntries, levelFilter, typeFilter, sourceFilter]);

  // Use dynamic row height hook
  // Include containerWidth as dependency to recalculate when text wraps
  // Include listVersion to recalculate when items are expanded/collapsed
  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: 100,
    key: `console-log-entries-${containerWidth}-${listVersion}`,
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

  // Auto-scroll to bottom when new entries arrive (if first render or user is near bottom)
  useEffect(() => {
    if (filteredEntries.length > 0 && containerHeight > 0) {
      const listElement = listRef.current?.element;

      // If this is the first render or we haven't scrolled to bottom yet, always scroll to bottom
      // This handles the case when the console panel opens with existing entries
      if (isFirstRender.current || !hasScrolledToBottom.current) {
        // Use requestAnimationFrame to ensure the list is fully rendered
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            listRef.current?.scrollToRow({
              index: filteredEntries.length - 1,
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
          index: filteredEntries.length - 1,
          align: "end",
        });
      }
    }
  }, [filteredEntries, listRef, isNearBottom, containerHeight]);

  const handleClearFilters = () => {
    setLevelFilter("all");
    setTypeFilter("all");
    setSourceFilter("");
  };

  // Generate unique key for each entry
  const getEntryKey = (entry: (typeof filteredEntries)[0], index: number) => {
    return `${entry.timestamp}-${index}`;
  };

  // Toggle expansion state for an entry
  const toggleExpanded = (key: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    // Increment version to force list recalculation
    setListVersion((v) => v + 1);
  };

  // Row renderer component
  const RowComponent = ({ index, style }: RowComponentProps) => {
    const entry = filteredEntries[index];
    if (!entry) {
      return <div style={style} />;
    }

    const entryKey = getEntryKey(entry, index);
    const isExpanded = expandedEntries.has(entryKey);

    return (
      <div style={style}>
        <ConsoleEntryComponent
          type={entry.type}
          level={entry.level}
          timestamp={entry.timestamp}
          message={entry.message}
          sourceName={entry.sourceName}
          typeFilter={typeFilter}
          isExpanded={isExpanded}
          onToggleExpand={() => toggleExpanded(entryKey)}
        />
      </div>
    );
  };

  const listHeight = containerHeight - (showFilters ? 60 : 0);

  // Disable virtualization in test mode for easier e2e testing
  // Virtualization only renders visible DOM elements, which creates issues for E2E tests:
  // 1. Off-screen logs don't exist in the DOM and can't be queried by test selectors
  // 2. Tests would need complex scrolling logic to bring elements into view before interaction
  // 3. Race conditions and timing issues occur when waiting for virtualized elements to render after scrolling
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
        totalLogs={filteredEntries.length}
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
              {filteredEntries.map((entry, index) => {
                const entryKey = getEntryKey(entry, index);
                const isExpanded = expandedEntries.has(entryKey);

                return (
                  <div key={index}>
                    <ConsoleEntryComponent
                      type={entry.type}
                      level={entry.level}
                      timestamp={entry.timestamp}
                      message={entry.message}
                      sourceName={entry.sourceName}
                      typeFilter={typeFilter}
                      isExpanded={isExpanded}
                      onToggleExpand={() => toggleExpanded(entryKey)}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <List
              listRef={listRef}
              rowCount={filteredEntries.length}
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
