import {
  windowRegistry,
  type WindowRegistry,
} from "@/window_infrastructure/main/window_registry";
import type { WindowSessionId } from "@/window_infrastructure/types";
import type { VersionCommandResult } from "@/ipc/types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export class VersionPreviewPresentationService {
  private readonly initiatorByOperationId = new Map<
    string,
    {
      readonly windowSessionId: WindowSessionId;
      confirmed: boolean;
      expiry: ReturnType<typeof setTimeout> | null;
    }
  >();

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
      throw new DyadError(
        "Too many version preview operations are still settling. Please try again.",
        DyadErrorKind.Auth,
      );
    }
    const entry = {
      windowSessionId: windowSessionId as WindowSessionId,
      confirmed: false,
      expiry: null as ReturnType<typeof setTimeout> | null,
    };
    entry.expiry = setTimeout(() => {
      if (
        this.initiatorByOperationId.get(operationId) === entry &&
        !entry.confirmed
      ) {
        this.initiatorByOperationId.delete(operationId);
      }
    }, 0);
    this.initiatorByOperationId.set(operationId, entry);
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
    const entry = this.initiatorByOperationId.get(operationId);
    if (entry?.expiry) clearTimeout(entry.expiry);
    this.initiatorByOperationId.delete(operationId);
  }

  confirm(operationId: string): void {
    const entry = this.initiatorByOperationId.get(operationId);
    if (!entry) return;
    entry.confirmed = true;
    if (entry.expiry) clearTimeout(entry.expiry);
    entry.expiry = null;
  }

  originEndpointFor(operationId: string) {
    const entry = this.initiatorByOperationId.get(operationId);
    return entry
      ? this.windows.endpointForSession(entry.windowSessionId)
      : undefined;
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
    const initiator =
      this.initiatorByOperationId.get(operationId)?.windowSessionId;
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
