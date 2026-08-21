import {
  windowRegistry,
  type WindowRegistry,
} from "@/window_infrastructure/main/window_registry";
import type { WindowSessionId } from "@/window_infrastructure/types";
import { isDetailedGithubOpsErrorMessage } from "@/github_ops/error_message";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

// Authorization records the claim before revision admission. Keep it long
// enough to span an async authorization/actor queue, while exact dispatch IDs
// prevent a stale claim from being confirmed by a later retry.
const TENTATIVE_ROUTE_TTL_MS = 30_000;

interface GithubOpsRoute {
  readonly appId: number;
  readonly operationId: string;
  readonly windowSessionId: WindowSessionId;
}

export class GithubOpsPresentationService {
  private readonly confirmedByOperationId = new Map<string, GithubOpsRoute>();
  private readonly tentativeByDispatchId = new Map<
    string,
    GithubOpsRoute & {
      expiry: ReturnType<typeof setTimeout> | null;
    }
  >();
  private readonly toastTargetById = new Map<string, WindowSessionId>();

  constructor(private readonly windows: WindowRegistry = windowRegistry) {}

  recordInitiator(
    appId: number,
    operationId: string,
    windowSessionId: string | undefined,
    dispatchId: string = operationId,
  ): void {
    if (
      !windowSessionId ||
      this.confirmedByOperationId.has(operationId) ||
      this.tentativeByDispatchId.has(dispatchId)
    )
      return;
    if (
      this.confirmedByOperationId.size + this.tentativeByDispatchId.size >=
      256
    ) {
      const oldestTentative = this.tentativeByDispatchId.keys().next().value;
      if (!oldestTentative) {
        throw new DyadError(
          "Too many GitHub operations are still settling. Please try again.",
          DyadErrorKind.RateLimited,
        );
      }
      this.forgetTentative(oldestTentative);
    }
    const entry = {
      appId,
      operationId,
      windowSessionId: windowSessionId as WindowSessionId,
      expiry: null as ReturnType<typeof setTimeout> | null,
    };
    entry.expiry = setTimeout(() => {
      if (this.tentativeByDispatchId.get(dispatchId) === entry) {
        this.tentativeByDispatchId.delete(dispatchId);
      }
    }, TENTATIVE_ROUTE_TTL_MS);
    this.tentativeByDispatchId.set(dispatchId, entry);
  }

  confirm(operationId: string, dispatchId: string = operationId): void {
    const entry = this.tentativeByDispatchId.get(dispatchId);
    if (!entry || entry.operationId !== operationId) return;
    if (entry.expiry) clearTimeout(entry.expiry);
    entry.expiry = null;
    this.tentativeByDispatchId.delete(dispatchId);
    if (!this.confirmedByOperationId.has(operationId)) {
      this.confirmedByOperationId.set(operationId, entry);
    }
    for (const [candidateId, candidate] of this.tentativeByDispatchId) {
      if (candidate.operationId === operationId) {
        this.forgetTentative(candidateId);
      }
    }
  }

  showError(
    appId: number,
    operationId: string | undefined,
    message: string,
    toastScope: "operation" | "git-state" | "conflicts" = "operation",
  ): void {
    const initiator = operationId
      ? this.confirmedByOperationId.get(operationId)?.windowSessionId
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
    this.confirmedByOperationId.delete(operationId);
    for (const [dispatchId, entry] of this.tentativeByDispatchId) {
      if (entry.operationId === operationId) this.forgetTentative(dispatchId);
    }
  }

  forgetApp(appId: number): void {
    for (const [operationId, entry] of this.confirmedByOperationId) {
      if (entry.appId === appId) this.forget(operationId);
    }
    for (const [dispatchId, entry] of this.tentativeByDispatchId) {
      if (entry.appId === appId) this.forgetTentative(dispatchId);
    }
  }

  private forgetTentative(dispatchId: string): void {
    const entry = this.tentativeByDispatchId.get(dispatchId);
    if (entry?.expiry) clearTimeout(entry.expiry);
    this.tentativeByDispatchId.delete(dispatchId);
  }
}

export const githubOpsPresentationService = new GithubOpsPresentationService();
