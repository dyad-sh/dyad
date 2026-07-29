import { OperationRouteRegistry } from "@/window_infrastructure/main/operation_route_registry";
import {
  windowRegistry,
  type WindowRegistry,
} from "@/window_infrastructure/main/window_registry";
import type { WindowSessionId } from "@/window_infrastructure/types";

export const GITHUB_OPS_PRESENTATION_FALLBACK_POLICY =
  "initiator-then-app-window-then-focused-window" as const;

export interface GithubOpsPresentationRoute {
  readonly appId: number;
}

function createRouteRegistry(): OperationRouteRegistry<GithubOpsPresentationRoute> {
  return new OperationRouteRegistry<GithubOpsPresentationRoute>({
    maxUnresolved: 64,
    maxTerminalRetained: 128,
    snapshotRoute: (route) => Object.freeze({ ...route }),
    sameRoute: (left, right) => left.appId === right.appId,
  });
}

export class GithubOpsPresentationService {
  constructor(
    private readonly windows: WindowRegistry = windowRegistry,
    readonly routes = createRouteRegistry(),
  ) {}

  recordInitiator(
    operationId: string,
    actorInstanceId: string,
    appId: number,
    windowSessionId: string | undefined,
  ): void {
    this.routes.admit({
      operationId,
      owner: {
        ownerId: actorInstanceId,
        machineId: "github_ops",
        ...(windowSessionId
          ? { windowSessionId: windowSessionId as WindowSessionId }
          : {}),
        route: { appId },
      },
    });
  }

  showError(
    appId: number,
    operationId: string | undefined,
    message: string,
  ): void {
    const route = operationId
      ? this.routes
          .inspect()
          .routes.find((candidate) => candidate.operationId === operationId)
      : undefined;
    const initiator = route?.owner.windowSessionId as
      | WindowSessionId
      | undefined;
    const routedAppId = route?.owner.route.appId ?? appId;
    // Explicit fallback policy: the initiating window owns first delivery.
    // If it closed, prefer another window displaying the app, then the
    // focused ordinary-presentation target.
    const target =
      this.windows.routePresentation({
        effect: "operation-toast",
        ...(initiator ? { initiatorWindowSessionId: initiator } : {}),
        entity: { kind: "app", id: routedAppId },
      }) ??
      this.windows.routePresentation({
        effect: "ordinary",
        entity: { kind: "app", id: routedAppId },
      });
    if (!target) return;
    this.windows.endpointForSession(target)?.send("toast:error", { message });
  }

  markTerminal(operationId: string): boolean {
    const snapshot = this.routes
      .inspect()
      .routes.find((candidate) => candidate.operationId === operationId);
    if (!snapshot) return false;
    const admission = this.routes.admit({
      operationId,
      owner: snapshot.owner,
    });
    return this.routes.markTerminal(admission.handle);
  }

  releaseOwner(actorInstanceId: string): number {
    return this.routes.releaseOwner("github_ops", actorInstanceId);
  }

  inspectWindowRoutes(windowSessionId: string) {
    return this.routes.inspectWindowRoutes(windowSessionId);
  }

  inspect() {
    return this.routes.inspect();
  }

  dispose(): void {
    this.routes.dispose();
  }
}

export const githubOpsPresentationService = new GithubOpsPresentationService();
