import {
  windowRegistry,
  type WindowRegistry,
} from "@/window_infrastructure/main/window_registry";
import type { WindowSessionId } from "@/window_infrastructure/types";
import { isDetailedGithubOpsErrorMessage } from "@/github_ops/error_message";

export class GithubOpsPresentationService {
  private readonly initiatorByOperationId = new Map<string, WindowSessionId>();

  constructor(private readonly windows: WindowRegistry = windowRegistry) {}

  recordInitiator(
    operationId: string,
    windowSessionId: string | undefined,
  ): void {
    if (windowSessionId) {
      if (this.initiatorByOperationId.size >= 256) {
        const oldest = this.initiatorByOperationId.keys().next().value;
        if (oldest) this.initiatorByOperationId.delete(oldest);
      }
      this.initiatorByOperationId.set(
        operationId,
        windowSessionId as WindowSessionId,
      );
    }
  }

  showError(
    appId: number,
    operationId: string | undefined,
    message: string,
  ): void {
    const initiator = operationId
      ? this.initiatorByOperationId.get(operationId)
      : undefined;
    const target =
      this.windows.routePresentation({
        effect: "operation-toast",
        ...(initiator ? { initiatorWindowSessionId: initiator } : {}),
        entity: { kind: "app", id: appId },
      }) ??
      this.windows.routePresentation({
        effect: "ordinary",
        ...(initiator ? { initiatorWindowSessionId: initiator } : {}),
        entity: { kind: "app", id: appId },
      });
    if (!target) return;
    const persist =
      operationId === undefined && isDetailedGithubOpsErrorMessage(message);
    this.windows.endpointForSession(target)?.send("toast:error", {
      message,
      toastId: `github-ops-${appId}`,
      ...(persist ? { persist: true } : {}),
    });
  }

  forget(operationId: string | undefined): void {
    if (operationId) this.initiatorByOperationId.delete(operationId);
  }
}

export const githubOpsPresentationService = new GithubOpsPresentationService();
