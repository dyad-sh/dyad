import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  GripVertical,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

import { selectedAppIdAtom, previewModeAtom } from "@/atoms/appAtoms";
import { chatMessagesByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedFileAtom } from "@/atoms/viewAtoms";
import { ipc } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";
import { syncChatFromDb } from "@/lib/resyncChat";
import {
  isAssertionItem,
  moveAssertion,
  type AssertionPlanItem,
} from "@/lib/test_recorder/assertion_proposal";
import { parseAssertionsPayload } from "@/lib/test_recorder/assertion_tag";
import type { CustomTagState } from "./stateTypes";

/**
 * The `<dyad-test-assertions>` card: a reviewable plan of a recorded test's
 * steps with the AI's proposed assertions interleaved.
 *
 * Assertions are editable, removable, and drag-reorderable; nothing touches the
 * spec file until the user approves. The card is part of a persisted assistant
 * message, so its payload (and, after approval, its latched status) round-trips
 * through the message content.
 *
 * Layout is a timeline: one rail, a neutral node per recorded step, a filled
 * node per proposed assertion. The rail is what makes "this check runs after
 * that step" legible, and it lets the steps stay quiet context while the
 * assertions — the only thing the user actually decides on — carry the weight.
 * Color is restrained to the two places a decision happens: the assertion nodes
 * and the Approve button.
 */

/** The accent, in the recorder's purple. Also readable on a dark surface. */
const ACCENT_TEXT = "text-purple-700 dark:text-purple-300";
const ACCENT_NODE = "bg-purple-600 text-white dark:bg-purple-500";

const ICON_BUTTON =
  "shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors duration-150 " +
  "hover:bg-(--background-darker) hover:text-foreground " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Hidden until the row is hovered or something inside it takes focus. */
const ROW_ACTION =
  "opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 " +
  "group-focus-within/row:opacity-100 focus-visible:opacity-100 " +
  "motion-reduce:transition-none";

interface DyadTestAssertionsCardProps {
  node: {
    properties: {
      "proposal-id"?: string;
      status?: string;
      "spec-path"?: string;
      state?: CustomTagState;
    };
  };
  children?: React.ReactNode;
}

/** Flatten the parser's children into the raw JSON payload string. */
function toText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(toText).join("");
  return children == null || typeof children === "boolean"
    ? ""
    : String(children);
}

/**
 * The rail segment above/below a node; transparent at the two ends so the line
 * starts at the first node and stops at the last.
 *
 * `lead` is the height of the segment above a node, which is what centers that
 * node on its row's first line of text — steps and assertions set different
 * text sizes, so they need different leads.
 *
 * Tinted from the foreground rather than `--border`, which in dark mode is
 * within a hair of this card's own background and renders the rail invisible.
 */
function RailSegment({
  hidden,
  lead,
  grow,
}: {
  hidden: boolean;
  lead?: "step" | "assertion";
  grow?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "w-px",
        grow ? "flex-1" : lead === "assertion" ? "h-1" : "h-[9px]",
        hidden ? "bg-transparent" : "bg-muted-foreground/25",
      )}
    />
  );
}

export const DyadTestAssertionsCard: React.FC<DyadTestAssertionsCardProps> = ({
  node,
  children,
}) => {
  const proposalId = node.properties["proposal-id"] ?? "";
  const specPath = node.properties["spec-path"] ?? "";
  const approvedOnServer = node.properties.status === "approved";

  const rawPayload = useMemo(() => toText(children), [children]);
  const payload = useMemo(
    () => parseAssertionsPayload(rawPayload),
    [rawPayload],
  );

  const chatId = useAtomValue(selectedChatIdAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const setSelectedFile = useSetAtom(selectedFileAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const queryClient = useQueryClient();

  const [items, setItems] = useState<AssertionPlanItem[]>(
    () => payload?.items ?? [],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [expandedCodeId, setExpandedCodeId] = useState<string | null>(null);
  const [optimisticApproved, setOptimisticApproved] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  // Synchronous guard: state updates are async, so a fast double-click would
  // otherwise fire two applies before `isApproving` re-renders.
  const approvingRef = useRef(false);
  const editingIdRef = useRef<string | null>(null);
  editingIdRef.current = editingId;

  // Approving rewrites the message content, so re-seed from the server's plan
  // whenever it changes — but never stomp an edit the user is mid-way through.
  useEffect(() => {
    if (editingIdRef.current) return;
    setItems(payload?.items ?? []);
  }, [payload]);

  const isApproved = approvedOnServer || optimisticApproved;
  const assertions = items.filter(isAssertionItem);
  const hasBlankAssertion = assertions.some((item) => !item.text.trim());
  const checkCountLabel =
    assertions.length === 1 ? "1 check" : `${assertions.length} checks`;

  const updateAssertion = useCallback(
    (id: string, text: string) => {
      setItems((prev) =>
        prev.map((item) =>
          isAssertionItem(item) && item.id === id
            ? // The code no longer matches the sentence, so mark it for
              // re-synthesis on approve.
              { ...item, text, needsCode: true, origin: "user" as const }
            : item,
        ),
      );
    },
    [setItems],
  );

  const commitEdit = useCallback(() => {
    if (!editingId) return;
    updateAssertion(editingId, draftText.trim());
    setEditingId(null);
    setDraftText("");
  }, [draftText, editingId, updateAssertion]);

  const startEdit = (id: string, text: string) => {
    if (isApproved) return;
    setEditingId(id);
    setDraftText(text);
  };

  const removeAssertion = (id: string) => {
    if (isApproved) return;
    if (editingId === id) setEditingId(null);
    setItems((prev) =>
      prev.filter((item) => !isAssertionItem(item) || item.id !== id),
    );
    setLiveMessage("Assertion removed");
  };

  const addAssertionAfter = (index: number) => {
    if (isApproved) return;
    const id = crypto.randomUUID();
    setItems((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, {
        kind: "assertion",
        id,
        text: "",
        code: null,
        needsCode: true,
        origin: "user",
      });
      return next;
    });
    setEditingId(id);
    setDraftText("");
  };

  const moveByOffset = (index: number, offset: number) => {
    if (isApproved) return;
    // Compute outside setItems: a state updater must stay pure.
    const next = moveAssertion(items, index, index + offset);
    if (next === items) return;
    setItems(next);
    setLiveMessage(
      `Assertion moved to position ${index + offset + 1} of ${next.length}`,
    );
  };

  const handleDrop = (targetIndex: number) => {
    if (dragId === null) return;
    const fromIndex = items.findIndex(
      (item) => isAssertionItem(item) && item.id === dragId,
    );
    setDragId(null);
    if (fromIndex === -1) return;
    setItems((prev) => moveAssertion(prev, fromIndex, targetIndex));
  };

  const openSpecFile = () => {
    if (!specPath) return;
    setSelectedFile({ path: specPath });
    setPreviewMode("code");
  };

  const handleApprove = async () => {
    if (approvingRef.current || isApproved) return;
    if (!proposalId || chatId == null || appId == null) return;
    approvingRef.current = true;
    setIsApproving(true);
    setOptimisticApproved(true);
    try {
      const result = await ipc.tests.applyTestAssertions({
        appId,
        chatId,
        proposalId,
        items,
      });
      syncChatFromDb(
        chatId,
        setMessagesById,
        "[TEST-ASSERTIONS]",
        getDefaultStore(),
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.appFiles.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.tests.list({ appId }),
      });
      if (result.warning) {
        showError(result.warning);
      } else {
        showSuccess(
          `Added ${result.appliedCount} assertion${
            result.appliedCount === 1 ? "" : "s"
          } to ${result.specPath}`,
        );
      }
    } catch (error) {
      setOptimisticApproved(false);
      showError(
        error instanceof Error
          ? error.message
          : "Couldn't apply the assertions.",
      );
    } finally {
      approvingRef.current = false;
      setIsApproving(false);
    }
  };

  if (!payload) {
    return (
      <div
        className="my-1.5 rounded-xl border border-border/60 bg-(--background-lightest) px-3.5 py-3"
        data-testid="dyad-test-assertions-card"
      >
        <p className="text-sm font-medium text-foreground">Test assertions</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This proposal couldn&apos;t be read
          {specPath ? ` for ${specPath}` : ""}. Ask for assertions again to get
          a fresh one.
        </p>
      </div>
    );
  }

  const fileName = payload.specPath.split("/").pop() ?? payload.specPath;

  return (
    <div
      className="my-1.5 overflow-hidden rounded-xl border border-border/60 bg-(--background-lightest)"
      data-testid="dyad-test-assertions-card"
    >
      <div className="px-3.5 pt-2.5 pb-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-medium text-foreground">
            Test assertions
          </h3>
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
            data-testid={
              isApproved ? "dyad-test-assertions-approved-badge" : undefined
            }
          >
            {isApproved && <Check size={12} strokeWidth={2.5} />}
            {isApproved ? "Applied" : checkCountLabel}
          </span>
        </div>
        {/* Filename only: every recorded spec lives in e2e-tests/, and in a
            narrow chat panel the directory is what eats the truncation. */}
        <span
          className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground"
          title={payload.specPath}
        >
          {fileName}
        </span>
      </div>

      <ol className="border-t border-border/50 py-2" role="list">
        {items.map((item, index) => {
          const isFirst = index === 0;
          const isLast = index === items.length - 1;
          const isDropTarget = dragId !== null && !isApproved;
          const dropProps = isDropTarget
            ? {
                onDragOver: (e: React.DragEvent) => {
                  e.preventDefault();
                },
                onDrop: (e: React.DragEvent) => {
                  e.preventDefault();
                  handleDrop(index);
                },
              }
            : {};

          if (item.kind === "step") {
            return (
              <li
                key={`step-${item.stepIndex}`}
                data-testid={`dyad-test-assertions-step-${item.stepIndex}`}
                className="group/row flex gap-2.5 pr-2 pl-3.5"
                {...dropProps}
              >
                <div className="flex w-4 shrink-0 flex-col items-center">
                  <RailSegment hidden={isFirst} lead="step" />
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                  />
                  <RailSegment hidden={isLast} grow />
                </div>
                <div className="flex min-w-0 flex-1 items-start gap-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-xs leading-4 text-muted-foreground">
                    {item.text}
                  </span>
                  {!isApproved && (
                    <button
                      type="button"
                      onClick={() => addAssertionAfter(index)}
                      aria-label={`Add a check after step ${item.stepIndex + 1}`}
                      title="Add a check after this step"
                      className={cn(ICON_BUTTON, ROW_ACTION)}
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>
              </li>
            );
          }

          const isEditing = editingId === item.id;
          const isCodeOpen = expandedCodeId === item.id;
          return (
            <li
              key={item.id}
              data-testid={`dyad-test-assertions-assertion-${item.id}`}
              draggable={!isApproved && !isEditing}
              tabIndex={isApproved ? undefined : 0}
              aria-label={
                isApproved
                  ? undefined
                  : `Assertion: ${item.text || "not described yet"}. Alt with arrow keys to reorder.`
              }
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", item.id);
                setDragId(item.id);
              }}
              onDragEnd={() => setDragId(null)}
              onKeyDown={(e) => {
                // HTML5 drag is pointer-only; keep reordering reachable.
                if (!e.altKey) return;
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  moveByOffset(index, -1);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  moveByOffset(index, 1);
                }
              }}
              className={cn(
                "group/row flex gap-2.5 pr-2 pl-3.5 outline-none",
                "focus-visible:bg-(--background-lighter)",
                dragId === item.id && "opacity-50",
              )}
              {...dropProps}
            >
              <div className="flex w-4 shrink-0 flex-col items-center">
                <RailSegment hidden={isFirst} lead="assertion" />
                <span
                  aria-hidden
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full",
                    ACCENT_NODE,
                  )}
                >
                  <Check size={10} strokeWidth={3} />
                </span>
                <RailSegment hidden={isLast} grow />
              </div>

              <div className="flex min-w-0 flex-1 items-start gap-1.5 py-0.5">
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <textarea
                      autoFocus
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          commitEdit();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingId(null);
                          setDraftText("");
                        }
                      }}
                      rows={2}
                      placeholder="Describe what this should check…"
                      aria-label="Assertion description"
                      data-testid={`dyad-test-assertions-edit-${item.id}`}
                      className="w-full resize-none rounded-md border border-input bg-(--background-lighter) px-2 py-1 text-[13px] leading-5 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(item.id, item.text)}
                      disabled={isApproved}
                      title={isApproved ? undefined : "Click to edit"}
                      data-testid={`dyad-test-assertions-text-${item.id}`}
                      className={cn(
                        "w-full rounded-sm text-left text-[13px] leading-5 text-foreground",
                        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                        // Dotted underline on hover is the editable-text
                        // convention; it's what tells the user the sentence
                        // itself is the control.
                        "decoration-muted-foreground decoration-dotted underline-offset-4 hover:underline",
                        "disabled:cursor-default disabled:hover:no-underline",
                      )}
                    >
                      {item.text || (
                        <span className="text-muted-foreground italic">
                          Describe what this should check…
                        </span>
                      )}
                    </button>
                  )}

                  {(item.code || (item.needsCode && !isApproved)) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      {item.code && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedCodeId((prev) =>
                              prev === item.id ? null : item.id,
                            )
                          }
                          aria-expanded={isCodeOpen}
                          className="inline-flex items-center gap-0.5 rounded-sm text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ChevronRight
                            size={11}
                            className={cn(
                              "transition-transform duration-150 motion-reduce:transition-none",
                              isCodeOpen && "rotate-90",
                            )}
                          />
                          {isCodeOpen ? "Hide code" : "Show code"}
                        </button>
                      )}
                      {item.needsCode && !isApproved && (
                        <span className={cn("text-[11px]", ACCENT_TEXT)}>
                          Code written on approve
                        </span>
                      )}
                    </div>
                  )}

                  {item.code && isCodeOpen && (
                    <code className="mt-1 block overflow-x-auto rounded-md bg-(--background-darker) px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre text-foreground">
                      {item.code}
                    </code>
                  )}
                </div>

                {!isApproved && !isEditing && (
                  <>
                    <span
                      aria-hidden
                      title="Drag to move this check"
                      className={cn(
                        "shrink-0 cursor-grab p-0.5 text-muted-foreground",
                        ROW_ACTION,
                      )}
                    >
                      <GripVertical size={13} />
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAssertion(item.id)}
                      aria-label="Remove this check"
                      title="Remove"
                      data-testid={`dyad-test-assertions-remove-${item.id}`}
                      className={cn(
                        ICON_BUTTON,
                        ROW_ACTION,
                        "hover:text-destructive",
                      )}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {assertions.length === 0 && (
        <p className="px-3.5 pb-2.5 text-xs text-muted-foreground">
          {isApproved
            ? "No checks were added, so the test file is unchanged."
            : "No checks proposed. Point at a step to add your own."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-3.5 py-2.5">
        {isApproved ? (
          <>
            <span className="text-xs text-muted-foreground">
              {checkCountLabel} written into the test.
            </span>
            <button
              type="button"
              onClick={openSpecFile}
              data-testid="dyad-test-assertions-open-file-button"
              className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-(--background-darker) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open test file
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">
              {hasBlankAssertion
                ? "Describe every check before approving."
                : "Nothing is written until you approve."}
            </span>
            <button
              type="button"
              onClick={() => void handleApprove()}
              disabled={isApproving || hasBlankAssertion || !proposalId}
              data-testid="dyad-test-assertions-approve-button"
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 hover:bg-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-600 focus-visible:ring-offset-2 focus-visible:ring-offset-(--background-lightest) disabled:cursor-not-allowed disabled:opacity-50 dark:bg-purple-600 dark:hover:bg-purple-500"
            >
              {isApproving && (
                <Loader2
                  size={12}
                  className="animate-spin motion-reduce:hidden"
                />
              )}
              {isApproving ? "Applying…" : "Approve"}
            </button>
          </>
        )}
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </span>
    </div>
  );
};
