import type { VersionCommandResult } from "@/ipc/types";
import {
  OperationRouteRegistry,
  type OperationRouteAdmission,
  type OperationRouteHandle,
} from "@/window_infrastructure/main/operation_route_registry";
import {
  windowRegistry,
  type WindowRegistry,
} from "@/window_infrastructure/main/window_registry";
import type { WindowSessionId } from "@/window_infrastructure/types";
import { safeSend } from "../utils/safe_sender";

interface VersionPreviewRoute {
  readonly appId: number;
  readonly actorInstanceId?: string;
  readonly windowSessionId: WindowSessionId;
}

/**
 * Presentation is best-effort and first-writer-owned. If the initiating
 * window closes, the route remains unresolved for authoritative settlement,
 * but visible presentation is deliberately dropped instead of being sent to
 * an unrelated window.
 */
export class VersionPreviewPresentationService {
  readonly routes = new OperationRouteRegistry<VersionPreviewRoute>({
    maxUnresolved: 256,
    maxTerminalRetained: 128,
    snapshotRoute: (route) => Object.freeze({ ...route }),
    sameRoute: (left, right) =>
      left.appId === right.appId &&
      left.actorInstanceId === right.actorInstanceId &&
      left.windowSessionId === right.windowSessionId,
  });

  constructor(private readonly windows: WindowRegistry = windowRegistry) {}

  recordInitiator(
    appId: number,
    operationId: string,
    windowSessionId: string | undefined,
    actorInstanceId?: string,
  ): OperationRouteAdmission<VersionPreviewRoute> | undefined {
    if (!windowSessionId) return undefined;
    const admission = this.routes.admit({
      operationId,
      owner: {
        ownerId: operationId,
        machineId: "version_preview",
        windowSessionId,
        route: {
          appId,
          ...(actorInstanceId ? { actorInstanceId } : {}),
          windowSessionId: windowSessionId as WindowSessionId,
        },
      },
    });
    return admission;
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
    this.routes.releaseOwner("version_preview", operationId);
  }

  release(handle: OperationRouteHandle): void {
    this.routes.release(handle);
  }

  confirm(_operationId: string): void {
    // Admission is authoritative only after the runtime finalizer enqueues the
    // correlated request. Rollback calls forget() with the same generation.
  }

  settle(operationId: string): void {
    const route = this.routes
      .inspect()
      .routes.find((candidate) => candidate.operationId === operationId);
    if (!route || route.state === "terminal") return;
    const admission = this.routes.admit({
      operationId,
      owner: route.owner,
    });
    this.routes.markTerminal(admission.handle);
  }

  settleApp(appId: number): number {
    let settled = 0;
    for (const route of this.routes.inspect().routes) {
      if (route.owner.route.appId !== appId) continue;
      if (route.state === "terminal") continue;
      this.settle(route.operationId);
      settled += 1;
    }
    return settled;
  }

  settleActor(actorInstanceId: string): number {
    let settled = 0;
    for (const route of this.routes.inspect().routes) {
      if (route.owner.route.actorInstanceId !== actorInstanceId) continue;
      if (route.state === "terminal") continue;
      this.settle(route.operationId);
      settled += 1;
    }
    return settled;
  }

  settleMachine(): number {
    let settled = 0;
    for (const route of this.routes.inspect().routes) {
      if (route.owner.machineId !== "version_preview") continue;
      if (route.state === "terminal") continue;
      this.settle(route.operationId);
      settled += 1;
    }
    return settled;
  }

  originEndpointFor(operationId: string) {
    const route = this.routes
      .inspect()
      .routes.find((candidate) => candidate.operationId === operationId);
    return route
      ? this.windows.endpointForSession(route.owner.route.windowSessionId)
      : undefined;
  }

  inspect() {
    return this.routes.inspect();
  }

  dispose(): void {
    this.routes.dispose();
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
    safeSend(this.originEndpointFor(operationId), "version-preview:result", {
      operationId,
      appId,
      ...payload,
    });
  }
}

export const versionPreviewPresentationService =
  new VersionPreviewPresentationService();
