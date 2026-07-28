import { ipc } from "@/ipc/types";

type DeepLinkPayload = Parameters<
  Parameters<typeof ipc.events.misc.onDeepLinkReceived>[0]
>[0];
type ForceClosePayload = Parameters<
  Parameters<typeof ipc.events.system.onForceCloseDetected>[0]
>[0];
type TelemetryPayload = Parameters<
  Parameters<typeof ipc.events.system.onTelemetryEvent>[0]
>[0];
type ChatTabRemovalPayload = Parameters<
  Parameters<
    typeof ipc.events.windowInfrastructure.onRemoveTransferredChatTab
  >[0]
>[0];

export class ReplayEvent<T> {
  private readonly pending: T[] = [];
  private readonly listeners = new Set<(payload: T) => void>();

  emit(payload: T): void {
    if (this.listeners.size === 0) {
      this.pending.push(payload);
      return;
    }
    for (const listener of this.listeners) listener(payload);
  }

  subscribe(listener: (payload: T) => void): () => void {
    this.listeners.add(listener);
    const pending = this.pending.splice(0);
    for (const payload of pending) listener(payload);
    return () => this.listeners.delete(listener);
  }
}

export const earlyDeepLinkEvents = new ReplayEvent<DeepLinkPayload>();
export const earlyForceCloseEvents = new ReplayEvent<ForceClosePayload>();
export const earlyTelemetryEvents = new ReplayEvent<TelemetryPayload>();
export const earlyChatTabRemovalEvents =
  new ReplayEvent<ChatTabRemovalPayload>();
export const chatNavigationEvents = new ReplayEvent<{
  chatId: number;
  appId: number;
}>();

let registered = false;

export function registerEarlyRendererEvents(): void {
  if (registered) return;
  registered = true;
  ipc.events.misc.onDeepLinkReceived((payload) => {
    earlyDeepLinkEvents.emit(payload);
  });
  ipc.events.system.onForceCloseDetected((payload) => {
    earlyForceCloseEvents.emit(payload);
  });
  ipc.events.system.onTelemetryEvent((payload) => {
    earlyTelemetryEvents.emit(payload);
  });
  ipc.events.windowInfrastructure.onRemoveTransferredChatTab((payload) => {
    earlyChatTabRemovalEvents.emit(payload);
  });
}
