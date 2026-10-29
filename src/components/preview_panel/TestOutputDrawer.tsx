import { useAtomValue, useSetAtom, useStore } from "jotai";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { memo, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  closeTestOutputTabAtom,
  currentTestOutputTabsAtom,
  selectTestOutputTabAtom,
} from "@/atoms/testOutputAtoms";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// Only the drawer subscribes to streamed output, keeping each append from
// re-rendering the whole Tests panel and every test row.
export const TestOutputDrawer = memo(function TestOutputDrawer({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation("chat");
  const appId = useAtomValue(selectedAppIdAtom);
  const { tabs, selectedRunId } = useAtomValue(currentTestOutputTabsAtom);
  const selectTab = useSetAtom(selectTestOutputTabAtom);
  const closeTab = useSetAtom(closeTestOutputTabAtom);
  const store = useStore();
  const contentId = useId();
  const outputRef = useRef<HTMLPreElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef(new Map<number, HTMLButtonElement>());
  const selectedTab = tabs.find((tab) => tab.runId === selectedRunId);

  useEffect(() => {
    if (open && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [selectedTab?.output, selectedRunId, appId, open]);

  useEffect(() => {
    if (open && selectedRunId !== null) {
      tabRefs.current.get(selectedRunId)?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [selectedRunId, appId, open]);

  const dismissTab = (runId: number) => {
    if (appId === null) return;
    closeTab({ appId, runId });
    const nextRunId = store.get(currentTestOutputTabsAtom).selectedRunId;
    // Keep keyboard focus in the drawer when its focused close button vanishes.
    if (nextRunId !== null) tabRefs.current.get(nextRunId)?.focus();
    else toggleRef.current?.focus();
  };

  return (
    <div className="min-w-0 border-t border-border">
      <button
        ref={toggleRef}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={contentId}
        aria-label="Toggle test output"
        className="flex items-center gap-2 w-full px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-(--background-darkest) cursor-pointer"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Output
        {tabs.length > 0 && (
          <span className="text-muted-foreground/70">({tabs.length})</span>
        )}
      </button>
      {open && (
        <div id={contentId}>
          {tabs.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              No test output tabs. Run tests to see output.
            </p>
          ) : (
            <Tabs
              value={selectedRunId}
              onValueChange={(value) => {
                if (appId !== null && typeof value === "number") {
                  selectTab({ appId, runId: value });
                }
              }}
              className="min-w-0 gap-0"
            >
              <TabsList
                activateOnFocus
                aria-label="Test run output"
                className="h-auto w-full justify-start overflow-x-auto rounded-none border-b border-border bg-transparent p-0 scrollbar-on-hover"
              >
                {tabs.map((tab) => {
                  const target =
                    tab.target ??
                    (tab.fileCount > 1
                      ? t("testOutput.files", { count: tab.fileCount })
                      : t("testRunQueue.allTests"));
                  const label = t("testOutput.runLabel", {
                    number: tab.ordinal,
                    target,
                  });
                  return (
                    <div
                      key={tab.runId}
                      className={cn(
                        "flex shrink-0 items-center border-b-2 pr-1",
                        tab.runId === selectedRunId
                          ? "border-primary bg-(--background-darkest) text-foreground"
                          : "border-transparent text-muted-foreground",
                      )}
                    >
                      <TabsTrigger
                        ref={(element) => {
                          if (element) tabRefs.current.set(tab.runId, element);
                          else tabRefs.current.delete(tab.runId);
                        }}
                        value={tab.runId}
                        title={label}
                        onKeyDown={(event) => {
                          if (event.key === "Delete") {
                            event.preventDefault();
                            dismissTab(tab.runId);
                          }
                        }}
                        className="max-w-64 rounded-none px-3 py-2 text-xs data-active:bg-transparent data-active:shadow-none"
                      >
                        <span className="truncate">{label}</span>
                      </TabsTrigger>
                      <button
                        type="button"
                        aria-label={t("testOutput.closeRun", { label })}
                        title={t("testOutput.close")}
                        onClick={() => dismissTab(tab.runId)}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </TabsList>
              {tabs.map((tab) => (
                <TabsContent key={tab.runId} value={tab.runId} className="mt-0">
                  {tab.error && (
                    <p
                      role="status"
                      className="px-4 py-2 text-xs text-destructive"
                    >
                      {tab.error}
                    </p>
                  )}
                  <pre
                    ref={tab.runId === selectedRunId ? outputRef : undefined}
                    className="text-[11px] whitespace-pre-wrap break-words bg-(--background-darkest) px-4 py-2 max-h-48 overflow-auto"
                  >
                    {tab.output || "No output yet."}
                  </pre>
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      )}
    </div>
  );
});
