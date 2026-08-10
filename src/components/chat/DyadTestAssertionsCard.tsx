import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
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
import { useChatStreamManager } from "@/chat_stream/ChatStreamProvider";
import { useStreamChat } from "@/hooks/useStreamChat";
import { ipc } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess, showWarning } from "@/lib/toast";
import { syncChatFromDb } from "@/lib/resyncChat";
import {
  isAssertionItem,
  moveAssertion,
  type AssertionPlanItem,
} from "@/lib/test_recorder/assertion_proposal";
import { parseAssertionsPayload } from "@/lib/test_recorder/assertion_tag";
import {
  useUserInputReadModel,
  useUserInputRequests,
} from "@/user_input/hooks";
import type { CustomTagState } from "./stateTypes";

/**
 * The `<dyad-test-assertions>` card: a reviewable plan of a recorded test's steps
 * with the AI's proposed assertions interleaved, editable and drag-reorderable.
 * The test file does not exist while the card is reviewed — approving generates
 * it from this exact plan, then asks the agent to run it. The card lives in a
 * persisted assistant message, so its payload round-trips through the content.
 *
 * Layout is a timeline: one rail, a neutral node per step, a filled node per
 * assertion, so the steps stay quiet context while the assertions carry the
 * weight. Color is restrained to the two places a decision happens.
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
      "request-id"?: string;
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
 * The rail segment above/below a node; transparent at the ends so the line starts
 * at the first node and stops at the last. `lead` is the height above a node,
 * centering it on its row's first line of text — steps and assertions set
 * different text sizes. Tinted from the foreground rather than `--border`, which
 * in dark mode is within a hair of this card's background.
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
  const requestId = node.properties["request-id"] ?? "";
  const approvedOnServer = node.properties.status === "approved";
  const discardedOnServer = node.properties.status === "discarded";

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
  const chatStreamManager = useChatStreamManager();
  const { streamMessage } = useStreamChat();
  // The agent is parked on this card's request for as long as it's live, so
  // answering it resumes that turn. It won't be live for a card reloaded after
  // a restart, or one whose turn was stopped — those fall back to handing the
  // spec over as a fresh chat turn.
  const userInputReadModel = useUserInputReadModel();
  const userInputRequests = useUserInputRequests();
  const parkedRequest = requestId
    ? userInputRequests.get(requestId)
    : undefined;
  const isAgentWaiting =
    parkedRequest !== undefined && parkedRequest.status !== "settled";

  const [items, setItems] = useState<AssertionPlanItem[]>(
    () => payload?.items ?? [],
  );
  // Held locally until the rewritten message makes it back through
  // `syncChatFromDb`. Without it the card flips to "Generated" with "Open test
  // file" dead until the verification stream finishes.
  const [approvedSpecPath, setApprovedSpecPath] = useState<string | null>(null);
  const specPath = approvedSpecPath ?? node.properties["spec-path"] ?? "";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [expandedCodeId, setExpandedCodeId] = useState<string | null>(null);
  const [optimisticApproved, setOptimisticApproved] = useState(false);
  const [optimisticDiscarded, setOptimisticDiscarded] = useState(false);
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
  // Discarding freezes the plan too: nothing was written, but there is nothing
  // left to answer either. Persisted alongside the approval, so a reload can't
  // hand back a plan the user already declined.
  const discarded = discardedOnServer || optimisticDiscarded;
  const isLocked = isApproved || discarded;
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
    if (isLocked) return;
    setEditingId(id);
    setDraftText(text);
  };

  const removeAssertion = (id: string) => {
    if (isLocked) return;
    if (editingId === id) setEditingId(null);
    setItems((prev) =>
      prev.filter((item) => !isAssertionItem(item) || item.id !== id),
    );
    setLiveMessage("Assertion removed");
  };

  const addAssertionAfter = (index: number) => {
    if (isLocked) return;
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
    if (isLocked) return;
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

  /**
   * Ask the agent to run the spec the approval just generated. Only for a card
   * whose turn is no longer parked on it — a reload or a stopped stream. Sent as
   * a normal chat turn (Agent mode, where run_tests lives) so the run and any
   * fix are visible in the conversation.
   */
  const requestVerificationRun = (generatedSpecPath: string) => {
    if (chatId == null || !generatedSpecPath) return;
    streamMessage({
      prompt: [
        `I approved the assertions. Dyad generated ${generatedSpecPath} from my recording.`,
        "",
        `Run it with run_tests to make sure it actually works. If it fails, read the failure, decide whether the test or the app is wrong, fix it, and run it again until it passes — or tell me what's blocking it.`,
      ].join("\n"),
      chatId,
      requestedChatMode: "local-agent",
    });
  };

  const handleApprove = async () => {
    if (approvingRef.current || isLocked) return;
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
      setApprovedSpecPath(result.specPath || null);
      queryClient.invalidateQueries({ queryKey: queryKeys.appFiles.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.tests.list({ appId }),
      });
      // A warning can accompany a spec written perfectly well, so report success
      // and the caveat separately: a red error toast over a file that exists
      // reads as "nothing was saved".
      if (result.specPath) {
        showSuccess(`Generated ${result.specPath}`);
        if (result.warning) showWarning(result.warning);
      } else if (result.warning) {
        showError(result.warning);
      }
      // A recorded test nobody has run is a guess: replay can behave differently
      // from the hand-performed flow, so the agent gets the spec back either
      // way. The parked turn picks it up as its tool result and carries on
      // without a visible message; a card whose turn is gone — or whose request
      // expired between render and click — needs a new turn instead.
      const handedToParkedTurn =
        isAgentWaiting &&
        (await userInputReadModel.respond(requestId, {
          kind: "test-assertions",
          specPath: result.specPath || null,
          appliedCount: result.appliedCount,
        }));
      if (!handedToParkedTurn) {
        // The stream manager answers "is this chat streaming?" — without that
        // guard the DB snapshot would overwrite the live messages of a stream
        // that started meanwhile. The parked path skips the sync entirely: the
        // resumed turn streams the approved card down itself.
        syncChatFromDb(chatId, setMessagesById, "[TEST-ASSERTIONS]", (id) =>
          chatStreamManager.getIsStreaming(id),
        );
        requestVerificationRun(result.specPath);
      }
    } catch (error) {
      setOptimisticApproved(false);
      setApprovedSpecPath(null);
      showError(
        error instanceof Error
          ? error.message
          : "Couldn't generate the test file.",
      );
    } finally {
      approvingRef.current = false;
      setIsApproving(false);
    }
  };

  /**
   * Close the plan without writing anything. Only offered while the agent is
   * parked on it: it exists so a turn waiting on this card has an exit that
   * isn't the 30-minute deadline.
   */
  const handleDiscard = async () => {
    if (approvingRef.current || isLocked || !isAgentWaiting) return;
    approvingRef.current = true;
    setIsApproving(true);
    try {
      // Latched BEFORE the parked request is answered. Answering resumes the
      // agent's turn, which immediately re-reads this message row and keeps
      // streaming into it — a discard written after that read is overwritten by
      // the turn's own copy, and the closed plan comes back approvable on
      // reload. Ordering it first means the turn resumes reading a row that
      // already says "discarded".
      if (chatId != null && appId != null && proposalId) {
        try {
          await ipc.tests.discardTestAssertions({ appId, chatId, proposalId });
        } catch (error) {
          // Leave the plan exactly as it was rather than answering the turn
          // against a card that still reads as approvable.
          console.warn("Couldn't record the discarded assertion plan", error);
          const message =
            error instanceof Error ? error.message : String(error);
          showError(`Couldn't close the assertion plan: ${message}`);
          return;
        }
      }
      setOptimisticDiscarded(true);
      const answered = await userInputReadModel.respond(requestId, {
        kind: "test-assertions",
        specPath: null,
        appliedCount: 0,
      });
      if (!answered) {
        // The card stays discarded rather than reverting: the latch above
        // already succeeded, so the stored plan *is* declined and showing it as
        // approvable again would only lead to "this plan was closed" on the
        // next approve. `respond` has surfaced its own error, and a turn left
        // parked converges on the same outcome at its deadline — a park that
        // resolves to nothing is read as a close.
        console.warn(
          `Discarded assertion plan ${proposalId}, but couldn't notify the parked turn`,
        );
      }
    } finally {
      approvingRef.current = false;
      setIsApproving(false);
    }
  };

  if (!payload) {
    // The tag arrives a character at a time, so incomplete JSON is the normal
    // state for most of a turn — telling the user to start over while the model
    // is still writing the plan is both wrong and unrecoverable-sounding. The
    // parser hands us exactly the signal needed to tell the two apart.
    // Specifically "pending", not "not finished": `aborted`, `error` and
    // `warning` all mean the plan is never arriving, and treating them as
    // pending leaves the card spinning on "Preparing…" forever instead of
    // saying the proposal can't be read.
    const isPending = node.properties.state === "pending";
    return (
      <div
        className="my-1.5 rounded-xl border border-border/60 bg-(--background-lightest) px-3.5 py-3"
        data-testid="dyad-test-assertions-card"
      >
        <p className="text-sm font-medium text-foreground">
          {isPending ? "Preparing the test proposal…" : "Test assertions"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {isPending ? (
            "Naming the test, describing your recorded steps and proposing the checks."
          ) : (
            <>
              This proposal couldn&apos;t be read
              {specPath ? ` for ${specPath}` : ""}. Ask for assertions again to
              get a fresh one.
            </>
          )}
        </p>
      </div>
    );
  }

  // Filename only: every recorded spec lives in e2e-tests/, and in a narrow chat
  // panel the directory eats the truncation. Before approval the title stands in.
  const generatedPath = payload.specPath;
  const subtitle = generatedPath
    ? (generatedPath.split("/").pop() ?? generatedPath)
    : payload.testTitle;

  return (
    <div
      className="my-1.5 overflow-hidden rounded-xl border border-border/60 bg-(--background-lightest)"
      data-testid="dyad-test-assertions-card"
    >
      <div className="px-3.5 pt-2.5 pb-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-medium text-foreground">
            {isApproved ? "Recorded test" : "Review recorded test"}
          </h3>
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
            data-testid={
              isApproved && !isApproving
                ? "dyad-test-assertions-approved-badge"
                : undefined
            }
          >
            {/* "Generated" only once it actually is. The approval latches
                optimistically so the plan can't be edited or submitted twice
                while the write is in flight, but claiming the file exists
                before it does leaves a slow apply looking finished — and a
                failed one silently reverting from a terminal state. */}
            {isApproving ? (
              <Loader2
                size={12}
                className="animate-spin motion-reduce:hidden"
              />
            ) : (
              isApproved && <Check size={12} strokeWidth={2.5} />
            )}
            {isApproving
              ? "Generating…"
              : isApproved
                ? "Generated"
                : checkCountLabel}
          </span>
        </div>
        <span
          className={cn(
            "mt-0.5 block truncate text-[11px] text-muted-foreground",
            generatedPath && "font-mono",
          )}
          title={generatedPath ?? payload.testTitle}
        >
          {subtitle}
        </span>
      </div>

      <ol className="border-t border-border/50 py-2" role="list">
        {items.map((item, index) => {
          const isFirst = index === 0;
          const isLast = index === items.length - 1;
          const isDropTarget = dragId !== null && !isLocked;
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
                  {!isLocked && (
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
              draggable={!isLocked && !isEditing}
              tabIndex={isLocked ? undefined : 0}
              aria-label={
                isLocked
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
                      disabled={isLocked}
                      title={isLocked ? undefined : "Click to edit"}
                      data-testid={`dyad-test-assertions-text-${item.id}`}
                      className={cn(
                        "w-full rounded-sm text-left text-[13px] leading-5 text-foreground",
                        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                        // Dotted underline on hover is the editable-text
                        // convention: the sentence itself is the control.
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

                  {(item.code || (item.needsCode && !isLocked)) && (
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
                      {item.needsCode && !isLocked && (
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

                {!isLocked && !isEditing && (
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
            ? "No checks were added — the test replays the recorded steps only."
            : discarded
              ? "No checks were added."
              : "No checks proposed. Point at a step to add your own."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-3.5 py-2.5">
        {isApproving ? (
          // The approval is latched but the file isn't written yet. Its own row
          // rather than the terminal one: there is nothing to open, and the
          // wait is the whole state.
          <span
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            data-testid="dyad-test-assertions-generating-note"
          >
            <Loader2 size={12} className="animate-spin motion-reduce:hidden" />
            Generating the test file…
          </span>
        ) : isApproved ? (
          <>
            <span className="text-xs text-muted-foreground">
              Test generated with {checkCountLabel}.
            </span>
            <button
              type="button"
              onClick={openSpecFile}
              disabled={!specPath}
              data-testid="dyad-test-assertions-open-file-button"
              className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-(--background-darker) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50"
            >
              Open test file
            </button>
          </>
        ) : discarded ? (
          <span
            className="text-xs text-muted-foreground"
            data-testid="dyad-test-assertions-discarded-note"
          >
            Closed without generating a test.
          </span>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">
              {hasBlankAssertion
                ? "Describe every check before approving."
                : isAgentWaiting
                  ? "Dyad is waiting on this before it continues."
                  : "Approving generates the test file and runs it."}
            </span>
            {/* Only while the turn is parked on this card: otherwise there is
                nothing waiting, and "close" would just hide a usable plan. */}
            {isAgentWaiting && (
              <button
                type="button"
                onClick={() => void handleDiscard()}
                disabled={isApproving}
                data-testid="dyad-test-assertions-discard-button"
                className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-(--background-darker) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                Close without generating
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleApprove()}
              disabled={isApproving || hasBlankAssertion || !proposalId}
              data-testid="dyad-test-assertions-approve-button"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 hover:bg-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-600 focus-visible:ring-offset-2 focus-visible:ring-offset-(--background-lightest) disabled:cursor-not-allowed disabled:opacity-50 dark:bg-purple-600 dark:hover:bg-purple-500",
                !isAgentWaiting && "ml-auto",
              )}
            >
              {isApproving && (
                <Loader2
                  size={12}
                  className="animate-spin motion-reduce:hidden"
                />
              )}
              {isApproving ? "Generating…" : "Approve & generate"}
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
