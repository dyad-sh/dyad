import { appConsoleEntriesAtom, type ConsoleEntry } from "@/atoms/appAtoms";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState, useMemo, useCallback, memo } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { ConsoleEntryComponent } from "./ConsoleEntry";
import { ConsoleFilters } from "./ConsoleFilters";
import { useSettings } from "@/hooks/useSettings";

// Placeholder component shown during fast scrolling
const ScrollSeekPlaceholder = () => {
  return (
    <div className="font-mono text-xs py-2 px-4 border-b border-gray-200 dark:border-gray-700">
      <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
    </div>
  );
};

// Wrapper component for console items - memoized to prevent unnecessary re-renders
interface ConsoleItemProps {
  index: number;
  entry: ConsoleEntry | undefined;
  expandedEntries: Set<string>;
  typeFilter: string;
  getEntryKey: (entry: ConsoleEntry | undefined, index: number) => string;
  toggleExpanded: (key: string, index: number) => void;
}

const ConsoleItem = memo(
  ({
    index,
    entry,
    expandedEntries,
    typeFilter,
    getEntryKey,
    toggleExpanded,
  }: ConsoleItemProps) => {
    if (!entry) {
      return <div />;
    }

    const entryKey = getEntryKey(entry, index);
    const isExpanded = expandedEntries.has(entryKey);

    return (
      <div>
        <ConsoleEntryComponent
          type={entry.type}
          level={entry.level}
          timestamp={entry.timestamp}
          message={entry.message}
          sourceName={entry.sourceName}
          typeFilter={typeFilter}
          isExpanded={isExpanded}
          onToggleExpand={() => toggleExpanded(entryKey, index)}
        />
      </div>
    );
  },
);

ConsoleItem.displayName = "ConsoleItem";

// Console component
export const Console = () => {
  const consoleEntries = useAtomValue(appConsoleEntriesAtom);
  const { settings } = useSettings();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToBottom = useRef(false);
  const [showFilters, setShowFilters] = useState(false);
  const [containerHeight, setContainerHeight] = useState(0);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(
    new Set(),
  );

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

  // Track if user is near bottom (within 100px) for auto-scroll
  const [isNearBottom, setIsNearBottom] = useState(true);
  // Track if initial scroll has completed to prevent glitches during first interaction
  const initialScrollDone = useRef(false);
  // Track if user is actively scrolling to prevent auto-scroll conflicts
  const [isScrolling, setIsScrolling] = useState(false);

  const handleClearFilters = () => {
    setLevelFilter("all");
    setTypeFilter("all");
    setSourceFilter("");
  };

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
    consoleEntries.forEach((entry) => {
      if (entry.sourceName) sources.add(entry.sourceName);
    });
    return Array.from(sources).sort();
  }, [consoleEntries]);

  // Filter and sort console entries by timestamp
  const filteredEntries = useMemo(() => {
    return consoleEntries
      .filter((entry) => {
        if (levelFilter !== "all" && entry.level !== levelFilter) return false;
        if (typeFilter !== "all" && entry.type !== typeFilter) return false;
        if (
          sourceFilter &&
          sourceFilter !== "all" &&
          entry.sourceName !== sourceFilter
        )
          return false;
        return true;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [consoleEntries, levelFilter, typeFilter, sourceFilter]);

  // Generate unique key for each entry
  const getEntryKey = useCallback(
    (entry: (typeof filteredEntries)[0] | undefined, index: number) => {
      if (!entry) return `entry-${index}`;
      return `${entry.timestamp}-${index}`;
    },
    [],
  );

  // Toggle expansion state for an entry
  const toggleExpanded = useCallback((key: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Item renderer function for react-virtuoso
  const ItemContent = useCallback(
    (index: number) => {
      return (
        <ConsoleItem
          index={index}
          entry={filteredEntries[index]}
          expandedEntries={expandedEntries}
          typeFilter={typeFilter}
          getEntryKey={getEntryKey}
          toggleExpanded={toggleExpanded}
        />
      );
    },
    [filteredEntries, expandedEntries, typeFilter, getEntryKey, toggleExpanded],
  );

  const listHeight = containerHeight - (showFilters ? 60 : 0);

  // Disable virtualization in test mode for easier e2e testing
  // Virtualization only renders visible DOM elements, which creates issues for E2E tests:
  // 1. Off-screen logs don't exist in the DOM and can't be queried by test selectors
  // 2. Tests would need complex scrolling logic to bring elements into view before interaction
  // 3. Race conditions and timing issues occur when waiting for virtualized elements to render after scrolling
  const isTestMode = settings?.isTestMode;

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
                  <div key={entryKey}>
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
            <Virtuoso
              ref={virtuosoRef}
              style={{ height: listHeight }}
              totalCount={filteredEntries.length}
              itemContent={ItemContent}
              defaultItemHeight={100}
              className="font-mono text-xs"
              initialTopMostItemIndex={
                filteredEntries.length > 0 ? filteredEntries.length - 1 : 0
              }
              followOutput={
                isNearBottom && initialScrollDone.current && !isScrolling
                  ? "auto"
                  : false
              }
              atBottomThreshold={100}
              atBottomStateChange={(atBottom) => {
                // atBottomThreshold makes this fire when within 100px of bottom
                setIsNearBottom(atBottom);
                if (atBottom) {
                  hasScrolledToBottom.current = true;
                  // Mark initial scroll as done after first time we reach bottom
                  if (!initialScrollDone.current) {
                    initialScrollDone.current = true;
                  }
                }
              }}
              // Detect when user is scrolling to prevent auto-scroll conflicts
              isScrolling={(scrolling) => {
                setIsScrolling(scrolling);
              }}
              increaseViewportBy={{ top: 500, bottom: 500 }}
              // Configure scroll seek placeholders for fast scrolling
              scrollSeekConfiguration={{
                enter: (velocity) => Math.abs(velocity) > 1000,
                exit: (velocity) => Math.abs(velocity) < 100,
              }}
              components={{
                ScrollSeekPlaceholder,
              }}
            />
          ))}
      </div>
    </div>
  );
};
