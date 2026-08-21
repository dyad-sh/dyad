import {
  windowRegistry,
  type WindowRegistry,
} from "@/window_infrastructure/main/window_registry";
import type { WindowSessionId } from "@/window_infrastructure/types";
import { isDetailedGithubOpsErrorMessage } from "@/github_ops/error_message";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export class GithubOpsPresentationService {
  private readonly initiatorByOperationId = new Map<
    string,
    {
      readonly windowSessionId: WindowSessionId;
      confirmed: boolean;
      expiry: ReturnType<typeof setTimeout> | null;
    }
  >();
  private readonly toastTargetById = new Map<string, WindowSessionId>();

  constructor(private readonly windows: WindowRegistry = windowRegistry) {}

  recordInitiator(
    operationId: string,
    windowSessionId: string | undefined,
  ): void {
    if (!windowSessionId || this.initiatorByOperationId.has(operationId))
      return;
    if (this.initiatorByOperationId.size >= 256) {
      throw new DyadError(
        "Too many GitHub operations are still settling. Please try again.",
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

  confirm(operationId: string): void {
    const entry = this.initiatorByOperationId.get(operationId);
    if (!entry) return;
    entry.confirmed = true;
    if (entry.expiry) clearTimeout(entry.expiry);
    entry.expiry = null;
  }

  showError(
    appId: number,
    operationId: string | undefined,
    message: string,
    toastScope: "operation" | "git-state" | "conflicts" = "operation",
  ): void {
    const initiator = operationId
      ? this.initiatorByOperationId.get(operationId)?.windowSessionId
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
    const toastId = `github-ops-${appId}-${toastScope}`;
    this.toastTargetById.set(toastId, target);
    this.windows.endpointForSession(target)?.send("toast:error", {
      message,
      toastId,
      ...(persist ? { persist: true } : {}),
    });
  }

  dismissError(appId: number, toastScope: "git-state" | "conflicts"): void {
    const toastId = `github-ops-${appId}-${toastScope}`;
    const target = this.toastTargetById.get(toastId);
    if (!target) return;
    this.windows.endpointForSession(target)?.send("toast:dismiss", {
      toastId,
    });
    this.toastTargetById.delete(toastId);
  }

  forget(operationId: string | undefined): void {
    if (!operationId) return;
    const entry = this.initiatorByOperationId.get(operationId);
    if (entry?.expiry) clearTimeout(entry.expiry);
    this.initiatorByOperationId.delete(operationId);
  }
}

export const githubOpsPresentationService = new GithubOpsPresentationService();
