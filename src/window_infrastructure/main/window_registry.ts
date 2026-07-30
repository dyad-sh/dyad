import { randomUUID } from "node:crypto";
import type {
  CapabilityLeaseLossReason,
  ChatTabOwnership,
  PresentationRouteRequest,
  ScreenshotCapability,
  VisibleEntity,
  WindowCapabilityLease,
  WindowCapabilityRequest,
  WindowSessionId,
} from "../types";
import { visibleEntityKey } from "../types";

export interface WindowEndpoint {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
  once?(event: "destroyed", listener: () => void): this | void;
}

interface MutableCapabilityLease {
  leaseId: string;
  kind: "screenshot";
  appId: number;
  holderWindowSessionId: WindowSessionId;
  iframeEpoch: number;
  lossPolicy: "retry" | "settle";
  active: boolean;
  reason: CapabilityLeaseLossReason | null;
}

interface WindowRecord {
  endpoint: WindowEndpoint;
  sessionId: WindowSessionId;
  visibleEntityKeys: Set<string>;
  chatTabs: Map<number, string>;
  focusSequence: number;
  screenshotCapabilities: Map<number, number>;
}

export interface WindowRegistryOptions {
  development?: boolean;
  onSingleWindowDivergence?: (
    request: PresentationRouteRequest,
    identityAnswer: WindowSessionId,
    fallbackAnswer: WindowSessionId | null,
  ) => void;
}

export class WindowRegistry {
  private readonly byWebContentsId = new Map<number, WindowRecord>();
  private readonly webContentsIdBySession = new Map<WindowSessionId, number>();
  private readonly activeLeaseByCapability = new Map<
    string,
    MutableCapabilityLease
  >();
  private readonly unregisterListeners = new Set<
    (id: number, sessionId: WindowSessionId) => void
  >();
  private focusSequence = 0;

  constructor(private readonly options: WindowRegistryOptions = {}) {}

  register(endpoint: WindowEndpoint, windowSessionId: WindowSessionId): void {
    const existingId = this.webContentsIdBySession.get(windowSessionId);
    if (existingId !== undefined && existingId !== endpoint.id) {
      this.unregister(existingId);
    }
    this.unregister(endpoint.id);
    this.byWebContentsId.set(endpoint.id, {
      endpoint,
      sessionId: windowSessionId,
      visibleEntityKeys: new Set(),
      chatTabs: new Map(),
      focusSequence: 0,
      screenshotCapabilities: new Map(),
    });
    this.webContentsIdBySession.set(windowSessionId, endpoint.id);
    endpoint.once?.("destroyed", () => this.unregister(endpoint.id));
  }

  ensureRegistered(endpoint: WindowEndpoint): WindowSessionId {
    const existing = this.byWebContentsId.get(endpoint.id);
    if (existing) return existing.sessionId;
    const sessionId = randomUUID() as WindowSessionId;
    this.register(endpoint, sessionId);
    return sessionId;
  }

  unregister(webContentsId: number): void {
    const record = this.byWebContentsId.get(webContentsId);
    if (!record) return;
    this.byWebContentsId.delete(webContentsId);
    if (this.webContentsIdBySession.get(record.sessionId) === webContentsId) {
      this.webContentsIdBySession.delete(record.sessionId);
    }
    for (const lease of this.activeLeaseByCapability.values()) {
      if (lease.holderWindowSessionId === record.sessionId) {
        this.revokeLease(lease, "window-destroyed");
      }
    }
    for (const listener of this.unregisterListeners) {
      listener(webContentsId, record.sessionId);
    }
  }

  onUnregister(
    listener: (webContentsId: number, windowSessionId: WindowSessionId) => void,
  ): () => void {
    this.unregisterListeners.add(listener);
    return () => this.unregisterListeners.delete(listener);
  }

  setFocused(windowSessionId: WindowSessionId): void {
    const record = this.recordForSession(windowSessionId);
    if (record) record.focusSequence = ++this.focusSequence;
  }

  setVisibleEntities(
    windowSessionId: WindowSessionId,
    entities: readonly VisibleEntity[],
  ): void {
    const record = this.recordForSession(windowSessionId);
    if (!record) return;
    record.visibleEntityKeys = new Set(entities.map(visibleEntityKey));
  }

  findWindowsShowing(entity: VisibleEntity): readonly WindowSessionId[] {
    const key = visibleEntityKey(entity);
    return this.liveRecords()
      .filter((record) => record.visibleEntityKeys.has(key))
      .sort((left, right) => right.focusSequence - left.focusSequence)
      .map((record) => record.sessionId);
  }

  setChatTabOwnership(
    windowSessionId: WindowSessionId,
    tabs: readonly ChatTabOwnership[],
  ): void {
    const record = this.recordForSession(windowSessionId);
    if (!record) return;
    record.chatTabs = new Map(
      tabs.map((tab) => [tab.chatId, tab.tabInstanceId]),
    );
  }

  ownsChatTab(
    windowSessionId: WindowSessionId,
    chatId: number,
    tabInstanceId: string,
  ): boolean {
    return (
      this.recordForSession(windowSessionId)?.chatTabs.get(chatId) ===
      tabInstanceId
    );
  }

  refreshChatTabOwnershipForTransfer(
    windowSessionId: WindowSessionId,
    tabs: readonly ChatTabOwnership[],
    chatId: number,
    tabInstanceId: string,
  ): boolean {
    if (!this.ownsChatTab(windowSessionId, chatId, tabInstanceId)) return false;
    this.setChatTabOwnership(windowSessionId, tabs);
    return true;
  }

  removeOwnedChatTab(
    windowSessionId: WindowSessionId,
    chatId: number,
    tabInstanceId: string,
  ): void {
    const record = this.recordForSession(windowSessionId);
    if (record?.chatTabs.get(chatId) === tabInstanceId) {
      record.chatTabs.delete(chatId);
    }
  }

  findWindowsOwningChat(chatId: number): readonly WindowSessionId[] {
    return this.liveRecords()
      .filter((record) => record.chatTabs.has(chatId))
      .sort((left, right) => right.focusSequence - left.focusSequence)
      .map((record) => record.sessionId);
  }

  routePresentation(request: PresentationRouteRequest): WindowSessionId | null {
    const records = this.liveRecords();
    if (records.length === 1) {
      const identityAnswer = records[0].sessionId;
      if (this.options.development) {
        const fallbackAnswer = this.routeWithFullFallback(request, records);
        if (fallbackAnswer !== identityAnswer) {
          this.options.onSingleWindowDivergence?.(
            request,
            identityAnswer,
            fallbackAnswer,
          );
        }
      }
      return identityAnswer;
    }
    return this.routeWithFullFallback(request, records);
  }

  presentationTargets(
    request: PresentationRouteRequest,
  ): readonly WindowSessionId[] {
    const records = this.liveRecords();
    if (records.length === 1) return [records[0].sessionId];
    if (
      (request.effect === "inline-shared-error" ||
        request.effect === "user-input") &&
      request.entity
    ) {
      return this.findWindowsShowing(request.entity);
    }
    const target = this.routeWithFullFallback(request, records);
    return target ? [target] : [];
  }

  advertiseScreenshotCapability(
    windowSessionId: WindowSessionId,
    capability: ScreenshotCapability,
  ): void {
    const record = this.recordForSession(windowSessionId);
    if (!record) return;
    const previousEpoch = record.screenshotCapabilities.get(capability.appId);
    record.screenshotCapabilities.set(capability.appId, capability.iframeEpoch);
    const lease = this.activeLeaseByCapability.get(
      this.capabilityKey(capability.kind, capability.appId),
    );
    if (
      lease?.holderWindowSessionId === windowSessionId &&
      previousEpoch !== undefined &&
      previousEpoch !== capability.iframeEpoch
    ) {
      this.revokeLease(lease, "iframe-epoch-changed");
    }
  }

  withdrawScreenshotCapability(
    windowSessionId: WindowSessionId,
    appId: number,
  ): void {
    this.recordForSession(windowSessionId)?.screenshotCapabilities.delete(
      appId,
    );
    const lease = this.activeLeaseByCapability.get(
      this.capabilityKey("screenshot", appId),
    );
    if (lease?.holderWindowSessionId === windowSessionId) {
      this.revokeLease(lease, "capability-withdrawn");
    }
  }

  claimCapability(
    request: WindowCapabilityRequest,
  ): WindowCapabilityLease | null {
    const key = this.capabilityKey(request.kind, request.appId);
    const existing = this.activeLeaseByCapability.get(key);
    if (existing?.active) return this.readonlyLease(existing);

    const candidates = this.liveRecords().filter((record) =>
      record.screenshotCapabilities.has(request.appId),
    );
    const preferred = request.preferredWindowSessionId
      ? candidates.find(
          (candidate) =>
            candidate.sessionId === request.preferredWindowSessionId,
        )
      : undefined;
    const holder =
      preferred ??
      candidates.sort(
        (left, right) => right.focusSequence - left.focusSequence,
      )[0];
    if (!holder) return null;
    const lease: MutableCapabilityLease = {
      leaseId: randomUUID(),
      kind: "screenshot",
      appId: request.appId,
      holderWindowSessionId: holder.sessionId,
      iframeEpoch: holder.screenshotCapabilities.get(request.appId)!,
      lossPolicy: request.lossPolicy,
      active: true,
      reason: null,
    };
    this.activeLeaseByCapability.set(key, lease);
    return this.readonlyLease(lease);
  }

  sessionForWebContents(webContentsId: number): WindowSessionId | undefined {
    return this.byWebContentsId.get(webContentsId)?.sessionId;
  }

  endpointForSession(sessionId: WindowSessionId): WindowEndpoint | undefined {
    return this.recordForSession(sessionId)?.endpoint;
  }

  liveEndpoints(): readonly WindowEndpoint[] {
    return this.liveRecords().map((record) => record.endpoint);
  }

  snapshot(): readonly {
    webContentsId: number;
    windowSessionId: WindowSessionId;
    visibleEntities: readonly string[];
    focused: boolean;
  }[] {
    const focusedSequence = Math.max(
      0,
      ...this.liveRecords().map((record) => record.focusSequence),
    );
    return this.liveRecords().map((record) => ({
      webContentsId: record.endpoint.id,
      windowSessionId: record.sessionId,
      visibleEntities: [...record.visibleEntityKeys],
      focused: focusedSequence > 0 && record.focusSequence === focusedSequence,
    }));
  }

  private routeWithFullFallback(
    request: PresentationRouteRequest,
    records: readonly WindowRecord[],
  ): WindowSessionId | null {
    if (request.effect === "important-completion") return null;
    if (
      request.effect === "operation-toast" ||
      request.effect === "navigation"
    ) {
      return request.initiatorWindowSessionId &&
        records.some(
          (record) => record.sessionId === request.initiatorWindowSessionId,
        )
        ? request.initiatorWindowSessionId
        : null;
    }
    if (request.initiatorWindowSessionId) {
      const initiator = records.find(
        (record) => record.sessionId === request.initiatorWindowSessionId,
      );
      if (initiator) return initiator.sessionId;
    }
    if (request.entity) {
      const showing = this.findWindowsShowing(request.entity);
      if (showing.length > 0) return showing[0];
    }
    const focused = [...records].sort(
      (left, right) => right.focusSequence - left.focusSequence,
    )[0];
    return focused && focused.focusSequence > 0 ? focused.sessionId : null;
  }

  private liveRecords(): WindowRecord[] {
    const live: WindowRecord[] = [];
    for (const record of this.byWebContentsId.values()) {
      if (record.endpoint.isDestroyed()) {
        this.unregister(record.endpoint.id);
      } else {
        live.push(record);
      }
    }
    return live;
  }

  private recordForSession(
    windowSessionId: WindowSessionId,
  ): WindowRecord | undefined {
    const id = this.webContentsIdBySession.get(windowSessionId);
    return id === undefined ? undefined : this.byWebContentsId.get(id);
  }

  private capabilityKey(kind: "screenshot", appId: number): string {
    return `${kind}:${appId}`;
  }

  private revokeLease(
    lease: MutableCapabilityLease,
    reason: CapabilityLeaseLossReason,
  ): void {
    lease.active = false;
    lease.reason = reason;
    this.activeLeaseByCapability.delete(
      this.capabilityKey(lease.kind, lease.appId),
    );
  }

  private readonlyLease(lease: MutableCapabilityLease): WindowCapabilityLease {
    return {
      leaseId: lease.leaseId,
      kind: lease.kind,
      appId: lease.appId,
      holderWindowSessionId: lease.holderWindowSessionId,
      iframeEpoch: lease.iframeEpoch,
      lossPolicy: lease.lossPolicy,
      isActive: () => lease.active,
      lossReason: () => lease.reason,
      shouldRetry: () => !lease.active && lease.lossPolicy === "retry",
    };
  }
}

export const windowRegistry = new WindowRegistry({
  development: process.env.NODE_ENV === "development",
  onSingleWindowDivergence: (request, identityAnswer, fallbackAnswer) => {
    console.warn("WindowRegistry N=1 shadow routing divergence", {
      request,
      identityAnswer,
      fallbackAnswer,
    });
  },
});
