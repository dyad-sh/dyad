import {
  windowRegistry,
  type WindowRegistry,
} from "@/window_infrastructure/main/window_registry";
import type { WindowSessionId } from "@/window_infrastructure/types";
import type { VersionCommandResult } from "@/ipc/types";

export class VersionPreviewPresentationService {
  private readonly initiatorByOperationId = new Map<string, WindowSessionId>();

  constructor(private readonly windows: WindowRegistry = windowRegistry) {}

  recordInitiator(
    operationId: string,
    windowSessionId: string | undefined,
  ): void {
    if (!windowSessionId) return;
    const existing = this.initiatorByOperationId.get(operationId);
    if (existing) {
      // Operation IDs are ownership claims. A duplicate from another window
      // must not redirect an already-running operation's presentation.
      return;
    }
    if (this.initiatorByOperationId.size >= 256) {
      // Never evict an unresolved operation: its eventual presentation must
      // remain bound to the initiating window. The new operation can still
      // fall back through WindowRegistry routing if the bounded map is full.
      return;
    }
    this.initiatorByOperationId.set(
      operationId,
      windowSessionId as WindowSessionId,
    );
  }

  publishResult(
    appId: number,
    operationId: string,
    result: VersionCommandResult,
  ): void {
    this.send(appId, operationId, {
      notification: result.notification,
      affectedChatId: result.affectedChatId,
      createdChatId: result.createdChatId,
    });
  }

  publishError(appId: number, operationId: string, message: string): void {
    this.send(appId, operationId, {
      notification: { kind: "error", message },
      affectedChatId: null,
      createdChatId: null,
    });
  }

  forget(operationId: string): void {
    this.initiatorByOperationId.delete(operationId);
  }

  originEndpointFor(operationId: string) {
    const sessionId = this.initiatorByOperationId.get(operationId);
    return sessionId ? this.windows.endpointForSession(sessionId) : undefined;
  }

  private send(
    appId: number,
    operationId: string,
    payload: {
      notification: {
        kind: "success" | "warning" | "error";
        message: string;
      } | null;
      affectedChatId: number | null;
      createdChatId: number | null;
    },
  ): void {
    const initiator = this.initiatorByOperationId.get(operationId);
    const target = this.windows.routePresentation({
      effect: payload.createdChatId !== null ? "navigation" : "operation-toast",
      ...(initiator ? { initiatorWindowSessionId: initiator } : {}),
      entity: { kind: "app", id: appId },
    });
    if (!target) return;
    this.windows.endpointForSession(target)?.send("version-preview:result", {
      operationId,
      appId,
      ...payload,
    });
  }
}

export const versionPreviewPresentationService =
  new VersionPreviewPresentationService();
