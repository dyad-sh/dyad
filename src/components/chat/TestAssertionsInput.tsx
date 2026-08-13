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
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FlaskConical,
  GripVertical,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

import { selectedAppIdAtom, previewModeAtom } from "@/atoms/appAtoms";
import { chatMessagesByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedFileAtom } from "@/atoms/viewAtoms";
import { useChatStreamManager } from "@/chat_stream/ChatStreamProvider";
import { useChatMessages } from "@/hooks/useChatMessages";
import { useStreamChat } from "@/hooks/useStreamChat";
import { ipc, type Message } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess, showWarning } from "@/lib/toast";
import { syncChatFromDb } from "@/lib/resyncChat";
import {
  isAssertionItem,
  moveAssertion,
  type AssertionPlanItem,
  type AssertionProposalPayload,
} from "@/lib/test_recorder/assertion_proposal";
import {
  listAssertionsTags,
  messageMayHaveAssertionsTag,
  parseAssertionsPayloadFromMessage,
  type AssertionsTagSummary,
} from "@/lib/test_recorder/assertion_tag";
import {
  useUserInputReadModel,
  useUserInputRequests,
} from "@/user_input/hooks";

/**
 * The recorded-test proposal, attached to the composer.
 *
 * The plan itself is persisted in an assistant message (a
 * `<dyad-test-assertions>` tag), but a plan waiting on a decision belongs with
 * the other things waiting on one — the questionnaire, the prompt queue, the
 * consent banner — rather than scrolled away up the transcript. So the live
 * plan is read back out of the message and rendered here, and the message
 * itself keeps only a receipt of what was decided (`DyadTestAssertionsCard`).
 *
 * Layout is a timeline: one rail, a neutral node per step, a filled node per
 * assertion, so the steps stay quiet context while the assertions carry the
 * weight. Color is restrained to the two places a decision happens. Recordings
 * run long, so the list is capped and scrolls rather than pushing the message
 * box off the screen.
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

/**
 * The unanswered plan in one message, cached on the message object.
 *
 * The scan below covers the WHOLE transcript — a plan left unanswered has to
 * stay reachable however far the conversation has moved on, because the message
 * itself now only carries a receipt — and it re-runs on every chunk of every
 * stream. This is what keeps that affordable: `applyStreamingPatch` rebuilds
 * only the message being streamed into and preserves every other message's
 * identity, so a stream re-reads one message per chunk and hits the cache for
 * the rest.
 */
const unansweredTagCache = new WeakMap<Message, AssertionsTagSummary | null>();

function unansweredTagIn(message: Message): AssertionsTagSummary | null {
  const cached = unansweredTagCache.get(message);
  if (cached !== undefined) return cached;
  let found: AssertionsTagSummary | null = null;
  if (
    message.role === "assistant" &&
    messageMayHaveAssertionsTag(message.content)
  ) {
    const proposed = listAssertionsTags(message.content).filter(
      (tag) => tag.status === "proposed",
    );
    // Last one in the message: a turn may propose twice, and the later plan is
    // the one the agent is parked on.
    found = proposed.at(-1) ?? null;
  }
  unansweredTagCache.set(message, found);
  return found;
}

interface LiveAssertionPlans {
  /** The one up for review: the most recent plan nobody has answered. */
  tag: AssertionsTagSummary | null;
  /**
   * How many plans are unanswered in total. More than one is a queue, not a
   * dead end — answering the one on top brings the previous one up.
   */
  pendingCount: number;
}

const NO_LIVE_PLANS: LiveAssertionPlans = { tag: null, pendingCount: 0 };

export function TestAssertionsInput() {
  const chatId = useAtomValue(selectedChatIdAtom);
  const messages = useChatMessages(chatId);
  const { tag, pendingCount } = useMemo(() => {
    let newest: AssertionsTagSummary | null = null;
    let pendingCount = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const found = unansweredTagIn(messages[i]);
      if (!found) continue;
      pendingCount++;
      newest ??= found;
    }
    return newest ? { tag: newest, pendingCount } : NO_LIVE_PLANS;
  }, [messages]);

  // Keyed on the tag TEXT, not the summary: the scan above re-runs whenever the
  // transcript changes, and re-seeding the rows from a fresh parse of an
  // unchanged plan would throw away the user's edits.
  const raw = tag?.raw ?? null;
  const payload = useMemo(
    () => (raw ? parseAssertionsPayloadFromMessage(raw) : null),
    [raw],
  );

  if (!tag || !payload) return null;

  return (
    <TestAssertionsPlanCard
      // A fresh plan starts from the server's rows, never from the previous
      // card's edits.
      key={tag.proposalId}
      proposalId={tag.proposalId}
      requestId={tag.requestId}
      payload={payload}
      pendingCount={pendingCount}
    />
  );
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
        grow ? "flex-1" : lead === "assertion" ? "h-0.5" : "h-[7px]",
        hidden ? "bg-transparent" : "bg-muted-foreground/25",
      )}
    />
  );
}

export function TestAssertionsPlanCard({
  proposalId,
  requestId,
  payload,
  pendingCount = 1,
}: {
  proposalId: string;
  /** Empty when no turn is parked on the plan — a reload, or a stopped stream. */
  requestId: string;
  payload: AssertionProposalPayload;
  /** Unanswered plans in this chat, including this one. */
  pendingCount?: number;
}) {
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

  /**
   * Is the turn STILL parked, read live rather than from the render snapshot?
   *
   * `respond` answers false for two very different things: a request main has
   * already dropped, and a transient IPC failure that left it parked. Only the
   * first is a licence to start a new turn.
   */
  const isStillParked = () => {
    const request = userInputReadModel.getSnapshot().requests.get(requestId);
    return request !== undefined && request.status !== "settled";
  };

  const [items, setItems] = useState<AssertionPlanItem[]>(payload.items);
  // Held locally until the rewritten message makes it back through
  // `syncChatFromDb`. Without it the card flips to "Generated" with "Open test
  // file" dead until the verification stream finishes.
  const [approvedSpecPath, setApprovedSpecPath] = useState<string | null>(null);
  const specPath = approvedSpecPath ?? "";
  const [isExpanded, setIsExpanded] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [expandedCodeId, setExpandedCodeId] = useState<string | null>(null);
  // The card is mounted only while the message still says the plan is up for
  // review, so these latches are what carry it through the write: the server's
  // rewrite unmounts it and the message's own receipt takes over.
  const [optimisticApproved, setOptimisticApproved] = useState(false);
  const [optimisticDiscarded, setOptimisticDiscarded] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  // Tracked apart from `isApproving` even though both disable the same
  // controls: closing a plan writes no file, and reusing the approval flag made
  // the card answer "Generating…" to a button that generates nothing.
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  // Synchronous guard: state updates are async, so a fast double-click would
  // otherwise fire two applies before the flags above re-render. Shared by both
  // operations — either one in flight rules out the other.
  const busyRef = useRef(false);
  const editingIdRef = useRef<string | null>(null);
  editingIdRef.current = editingId;

  // The agent can rewrite the plan while it's up for review, so re-seed from
  // the server's rows whenever they change — but never stomp an edit the user
  // is mid-way through. `payload` only changes identity when the tag text
  // does, so a restreamed message around an untouched card is a no-op.
  useEffect(() => {
    if (editingIdRef.current) return;
    setItems(payload.items);
  }, [payload]);

  const isApproved = optimisticApproved;
  // Discarding freezes the plan too: nothing was written, but there is nothing
  // left to answer either. Persisted alongside the approval, so a reload can't
  // hand back a plan the user already declined.
  const discarded = optimisticDiscarded;
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
    if (busyRef.current || isLocked) return;
    if (!proposalId || chatId == null || appId == null) return;
    busyRef.current = true;
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
      // A hand-off that failed on a transient IPC error leaves the turn sitting
      // on this card. Starting a fresh turn there would queue a second
      // generation behind the parked one and hand the agent the same spec
      // twice; `respond` has already surfaced the error, and the turn converges
      // on its deadline. The spec is written either way, and the card says so.
      if (!handedToParkedTurn && !isStillParked()) {
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
      busyRef.current = false;
      setIsApproving(false);
    }
  };

  /**
   * Close the plan without writing anything.
   *
   * Offered for every unanswered plan, not just a parked one. While a turn is
   * waiting this is its exit that isn't the 30-minute deadline; with no turn
   * waiting it is the ONLY exit, since the card is pinned to the composer
   * rather than scrolling away up the transcript — without it, a plan left over
   * from a stopped turn or a restart could only be dismissed by approving a
   * test the user may not want.
   */
  const handleDiscard = async () => {
    if (busyRef.current || isLocked) return;
    busyRef.current = true;
    setIsDiscarding(true);
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
      if (!isAgentWaiting) {
        // Nothing to resume: the latch above IS the close. Re-read the chat so
        // the message picks up its "discarded" receipt — otherwise the card
        // would stay pinned to the composer on the optimistic latch alone, and
        // any older unanswered plan behind it would never come up.
        if (chatId != null) {
          syncChatFromDb(chatId, setMessagesById, "[TEST-ASSERTIONS]", (id) =>
            chatStreamManager.getIsStreaming(id),
          );
        }
        return;
      }
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
      busyRef.current = false;
      setIsDiscarding(false);
    }
  };

  // Either operation locks the card's controls; only approving writes a file,
  // so the labels below still have to tell them apart.
  const isBusy = isApproving || isDiscarding;

  // Filename only once there is one: every recorded spec lives in e2e-tests/,
  // and in a narrow chat panel the directory eats the truncation. Before
  // approval the title stands in.
  const subtitle = specPath
    ? (specPath.split("/").pop() ?? specPath)
    : payload.testTitle;

  return (
    <div
      className="border-b border-border bg-muted/30"
      data-testid="dyad-test-assertions-card"
    >
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/50"
      >
        <FlaskConical className={cn("size-4 shrink-0", ACCENT_TEXT)} />
        <span className="shrink-0 text-sm">
          {isApproved ? "Recorded test" : "Review recorded test"}
          {/* A queue, not a dead end: answering this one brings the previous
              plan up. Says so, so a receipt further up the transcript reading
              "waiting for your review" has somewhere to point. */}
          {pendingCount > 1 && !isLocked && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              (1 of {pendingCount})
            </span>
          )}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs text-muted-foreground",
            specPath && "font-mono",
          )}
          title={subtitle}
        >
          {subtitle}
        </span>
        <span
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
          data-testid={
            isApproved && !isBusy
              ? "dyad-test-assertions-approved-badge"
              : undefined
          }
        >
          {/* "Generated" only once it actually is. The approval latches
              optimistically so the plan can't be edited or submitted twice
              while the write is in flight, but claiming the file exists
              before it does leaves a slow apply looking finished — and a
              failed one silently reverting from a terminal state.

              Closing gets its own label: it writes nothing, so announcing it
              as generation promises a file that is never coming. */}
          {isBusy ? (
            <Loader2 size={12} className="animate-spin motion-reduce:hidden" />
          ) : (
            isApproved && <Check size={12} strokeWidth={2.5} />
          )}
          {isApproving
            ? "Generating…"
            : isDiscarding
              ? "Closing…"
              : isApproved
                ? "Generated"
                : checkCountLabel}
        </span>
        {isExpanded ? (
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <ol
          className="max-h-44 overflow-y-auto border-t border-border/50 py-1"
          role="list"
        >
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
                  className="group/row flex gap-2 pr-2 pl-3"
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
                  <div className="flex min-w-0 flex-1 items-start gap-2 py-0.5">
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
                  "group/row flex gap-2 pr-2 pl-3 outline-none",
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

                <div className="flex min-w-0 flex-1 items-start gap-1.5 py-px">
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
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
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
                      <code className="mt-1 block overflow-x-auto rounded-md bg-(--background-darker) px-2 py-1 font-mono text-[11px] leading-relaxed whitespace-pre text-foreground">
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
      )}

      {isExpanded && assertions.length === 0 && (
        <p className="px-3 pb-1.5 text-xs text-muted-foreground">
          {isApproved
            ? "No checks were added — the test replays the recorded steps only."
            : discarded
              ? "No checks were added."
              : "No checks proposed. Point at a step to add your own."}
        </p>
      )}

      {/* Outside the collapse: folding away a long plan should hide the rows,
          not the decision the composer is blocked on. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-3 py-1.5">
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
        ) : isDiscarding ? (
          // Same shape, opposite promise: nothing is being written, so the row
          // says what is actually happening rather than borrowing the approval's.
          <span
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            data-testid="dyad-test-assertions-closing-note"
          >
            <Loader2 size={12} className="animate-spin motion-reduce:hidden" />
            Closing the plan…
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
            {/* One group, so the decision stays together on the right when the
                composer is too narrow to keep it on the hint's line. */}
            <div className="ml-auto flex items-center gap-2">
              {/* Every unanswered plan gets an exit. While a turn is parked
                  this saves it from its deadline; with none parked it is the
                  only way to put the card down, since it no longer scrolls
                  away up the transcript. */}
              <button
                type="button"
                onClick={() => void handleDiscard()}
                disabled={isBusy}
                data-testid="dyad-test-assertions-discard-button"
                className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-(--background-darker) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                Close without generating
              </button>
              <button
                type="button"
                onClick={() => void handleApprove()}
                disabled={isBusy || hasBlankAssertion || !proposalId}
                data-testid="dyad-test-assertions-approve-button"
                className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 hover:bg-purple-700 focus-visible:ring-2 focus-visible:ring-purple-600 focus-visible:ring-offset-2 focus-visible:ring-offset-(--background-lighter) focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-purple-600 dark:hover:bg-purple-500"
              >
                {isApproving && (
                  <Loader2
                    size={12}
                    className="animate-spin motion-reduce:hidden"
                  />
                )}
                {isApproving ? "Generating…" : "Approve & generate"}
              </button>
            </div>
          </>
        )}
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </span>
    </div>
  );
}
