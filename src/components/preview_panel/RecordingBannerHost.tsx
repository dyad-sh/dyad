import { useState } from "react";
import { useAtomValue } from "jotai";

import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { annotatorModeAtom } from "@/atoms/previewAtoms";
import { AgentModeRequiredDialog } from "./AgentModeRequiredDialog";
import { useChatMode } from "@/hooks/useChatMode";
import { useStreamChat } from "@/hooks/useStreamChat";
import type { TestRecorderController } from "@/hooks/useTestRecorder";
import { buildRecordedTestProposalPrompt } from "@/lib/test_recorder/assertion_request";
import { showError, showInfo } from "@/lib/toast";
import { MAX_CHAT_PROMPT_CHARS } from "@/shared/chatAttachmentLimits";
import { RecordingBanner } from "./RecordingBanner";

/**
 * The recording bar, mounted alongside the hoisted recorder rather than inside
 * the preview tab.
 *
 * A session outlives a trip to Code, Problems or Tests — it holds the app's
 * operation lock, keeps the app pointed at its isolated database and refuses
 * test runs the whole time. The bar is the only thing that says so and the only
 * place Stop, Cancel and Discard exist, so it has to be visible from wherever
 * the user ends up, not just the tab they started on. The same goes for the
 * post-stop review: its parked draft is reachable from nowhere else.
 */
export function RecordingBannerHost({
  recorder,
}: {
  recorder: TestRecorderController;
}) {
  const annotatorMode = useAtomValue(annotatorModeAtom);
  const previewMode = useAtomValue(previewModeAtom);

  // The annotator draws over the preview and owns that surface while it's on —
  // but only there. On any other tab the bar is the user's only way back to the
  // session, so annotator mode must not take it away from them.
  const hiddenByAnnotator = annotatorMode && previewMode === "preview";
  if (recorder.phase === "idle" || hiddenByAnnotator) return null;
  // Split so the chat plumbing below is only reached while a session is on
  // screen. This host is mounted for every app, recording or not, and the bar's
  // one action is the only thing here that needs a chat at all.
  return <ActiveRecordingBanner recorder={recorder} />;
}

function ActiveRecordingBanner({
  recorder,
}: {
  recorder: TestRecorderController;
}) {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { streamMessage } = useStreamChat();
  const { selectedMode } = useChatMode(selectedChatId);
  const isAgentMode = selectedMode === "local-agent";
  // True while the Agent-mode confirmation for the assertion pass is open.
  const [assertionsNeedAgentMode, setAssertionsNeedAgentMode] = useState(false);

  // Hand the recorded steps to the agent for the test proposal. Its
  // `generate_test_assertions` tool posts a reviewable card into the chat, and
  // approving that card is what generates the spec — so nothing is written
  // until the user has seen the name, the steps and the checks.
  const doGenerateAssertions = () => {
    const draft = recorder.draft;
    if (!draft) return;
    if (!selectedChatId) {
      showInfo("Open a chat to generate a test from the recording.");
      return;
    }
    const requestAppId = selectedAppId;
    const prompt = buildRecordedTestProposalPrompt(draft, recorder.draftSteps);
    // The recording travels in the message, so a long enough one can't be sent
    // at all — 5,000 actions is the recorder's cap and a single `fill` carries
    // up to 10,000 characters of value. `streamMessage` would refuse it anyway,
    // but as "your message is too long" about a message the user never wrote.
    // Say what is actually too big and what to do about it; the draft stays
    // parked either way, so the bar's other actions still work.
    if (prompt.length > MAX_CHAT_PROMPT_CHARS) {
      showError(
        "This recording is too large to send to the AI. Record a shorter flow, or discard this one and try again.",
      );
      return;
    }
    // Marked before the send: a submission that lands on the prompt queue
    // settles synchronously, and the clear below must not be overwritten by a
    // mark that runs after it.
    //
    // The review stays up until the user closes it. The request can fail, be
    // cancelled, or finish without ever calling the tool, and this bar is the
    // only UI that can ask again or discard the parked draft.
    recorder.markAwaitingAssertions();
    streamMessage({
      prompt,
      chatId: selectedChatId,
      requestedChatMode: "local-agent",
      // Every way this turn can end arrives here: a card posted and answered, a
      // reply that never called the tool, an error, or the user stopping the
      // chat. Only the approval closes the bar on its own, so without this the
      // "asking the AI" spinner outlives the request it describes. A submission
      // queued behind an active stream settles here straight away and its
      // callback is not carried through the queue, so it stops the spinner too —
      // the card still arrives when the queued turn runs.
      // Scoped to the draft this turn was dispatched for, like the prompt
      // above: a turn about a recording the user has since discarded and
      // replaced must not stop the spinner belonging to its replacement.
      onSettled: () => {
        if (requestAppId != null)
          recorder.clearAwaitingAssertions(requestAppId, draft.draftId);
      },
    });
    showInfo("Sent to chat — asking the AI for assertions…");
  };

  // Confirm the switch to Agent mode first when the chat is in another mode,
  // matching the Tests panel's "Generate test" / "Fix with AI" entry points.
  const handleGenerateAssertions = () => {
    if (isAgentMode) {
      doGenerateAssertions();
    } else {
      setAssertionsNeedAgentMode(true);
    }
  };

  return (
    <>
      <RecordingBanner
        recorder={recorder}
        onGenerateAssertions={handleGenerateAssertions}
      />
      <AgentModeRequiredDialog
        open={assertionsNeedAgentMode}
        onOpenChange={setAssertionsNeedAgentMode}
        action="assertions"
        onContinue={() => {
          doGenerateAssertions();
          setAssertionsNeedAgentMode(false);
        }}
      />
    </>
  );
}
