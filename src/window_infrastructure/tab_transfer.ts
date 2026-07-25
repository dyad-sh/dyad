import type { TabInstanceId, WindowSessionId } from "./types";

export interface TransferableTab<TState> {
  tabInstanceId: TabInstanceId;
  ownerWindowSessionId: WindowSessionId;
  state: TState;
}

export type TabTransferReceipt =
  | { status: "adopted-and-removed" }
  | { status: "adoption-rejected"; reason: string };

export async function adoptThenRemoveTab<TState>(
  tab: TransferableTab<TState>,
  destinationWindowSessionId: WindowSessionId,
  adopt: (
    tab: TransferableTab<TState> & {
      ownerWindowSessionId: WindowSessionId;
    },
  ) => Promise<{ accepted: boolean; reason?: string }>,
  removeSource: (tabInstanceId: TabInstanceId) => Promise<void> | void,
): Promise<TabTransferReceipt> {
  const adoption = await adopt({
    ...tab,
    ownerWindowSessionId: destinationWindowSessionId,
  });
  if (!adoption.accepted) {
    return {
      status: "adoption-rejected",
      reason: adoption.reason ?? "Destination rejected tab adoption",
    };
  }
  await removeSource(tab.tabInstanceId);
  return { status: "adopted-and-removed" };
}
