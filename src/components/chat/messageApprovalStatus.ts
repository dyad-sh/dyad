import type { Message } from "@/ipc/types";

export function getVisibleMessageApprovalState(
  approvalState: Message["approvalState"],
): "rejected" | null {
  return approvalState === "rejected" ? approvalState : null;
}
