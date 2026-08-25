import type { Message } from "@/ipc/types";

export function getVisibleMessageApprovalState(
  approvalState: Message["approvalState"],
): "rejected" | null {
  return approvalState === "rejected" ? approvalState : null;
}

export function shouldShowMessageFooter({
  hasAssistantText,
  isStreaming,
  hasHistoricalAssistantModel,
  visibleApprovalState,
}: {
  hasAssistantText: boolean;
  isStreaming: boolean;
  hasHistoricalAssistantModel: boolean;
  visibleApprovalState: "rejected" | null;
}): boolean {
  return (
    (hasAssistantText && !isStreaming) ||
    hasHistoricalAssistantModel ||
    visibleApprovalState !== null
  );
}
