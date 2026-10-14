/**
 * Process-wide record of where writable chat turns are running and which
 * workspaces are busy.
 *
 * Every decision that two concurrent submissions could race on (who gets the
 * app's original directory, whether a worktree is needed) happens inside one
 * synchronous call, so no `await` can interleave between "is anyone else
 * writing?" and "I am writing here now". Asynchronous callers re-enter through
 * `waitForChange`, which resolves on any reservation change.
 *
 * Ownership rules:
 * - A writable turn reserves either the original directory or an isolated
 *   workspace for its whole lifetime, and releases it in `finally`.
 * - An isolated workspace is exclusive between "a turn is running there" and
 *   "integration is merging/validating there". Read-only turns register as
 *   readers so retention never removes a workspace they are reading.
 * - Integration claims the original directory only for its final
 *   fast-forward; writable turns that would use the original wait for it.
 *
 * Nothing here is persisted: a restart has no running turns, and durable
 * workspace state lives in the `chat_workspaces` table.
 */

export type WritableTurnPlacement =
  | { kind: "original" }
  | { kind: "isolated"; workspaceId: number | null };

export interface WritableTurnReservation {
  readonly token: symbol;
  readonly appId: number;
  readonly chatId: number;
  placement: WritableTurnPlacement;
  /** Set while this reservation is creating its workspace. */
  creating?: boolean;
}

export type ReserveWritableTurnDecision =
  /** Use the app's original directory. */
  | { kind: "original"; reservation: WritableTurnReservation }
  /** Reuse the chat's existing isolated workspace. */
  | {
      kind: "existing-workspace";
      reservation: WritableTurnReservation;
      workspaceId: number;
    }
  /** Create a new isolated workspace; bind it with `bindWorkspace`. */
  | { kind: "new-workspace"; reservation: WritableTurnReservation }
  /** Something else owns what this turn needs; retry after `waitForChange`. */
  | {
      kind: "wait";
      reason:
        | "workspace-integrating"
        | "workspace-busy"
        | "original-integrating";
    };

export interface ReserveWritableTurnInput {
  appId: number;
  chatId: number;
  /** The chat's current isolated workspace, if it has one. */
  existingWorkspaceId: number | null;
  /** Whether new isolated workspaces may be created. */
  isolationEnabled: boolean;
}

type WorkspaceLock =
  | { owner: "turn"; token: symbol }
  | { owner: "integration"; token: symbol }
  | { owner: "removal"; token: symbol };

export class ChatWorkspaceRegistry {
  private readonly writableTurns = new Map<
    number,
    Map<symbol, WritableTurnReservation>
  >();
  private readonly workspaceLocks = new Map<number, WorkspaceLock>();
  private readonly workspaceReaders = new Map<number, number>();
  private readonly originalIntegrationClaims = new Map<number, symbol>();
  private readonly changeWaiters = new Set<() => void>();
  private readonly listeners = new Set<(appId: number) => void>();
  private version = 0;

  /** Increments on every reservation, lock, or claim change. */
  get changeVersion(): number {
    return this.version;
  }

  /**
   * Atomically chooses where a writable turn runs and reserves it.
   *
   * - A chat that already has an isolated workspace keeps using it.
   * - Otherwise the original directory is used when no other writable turn is
   *   running for the app (or isolation is disabled, which preserves the
   *   shared-directory behavior).
   * - Otherwise a new isolated workspace is reserved.
   */
  reserveWritableTurn(
    input: ReserveWritableTurnInput,
  ): ReserveWritableTurnDecision {
    const { appId, chatId, existingWorkspaceId, isolationEnabled } = input;
    if (existingWorkspaceId !== null) {
      const lock = this.workspaceLocks.get(existingWorkspaceId);
      if (lock?.owner === "integration" || lock?.owner === "removal") {
        // Removal re-reads as "no workspace" once it finishes.
        return { kind: "wait", reason: "workspace-integrating" };
      }
      if (lock?.owner === "turn") {
        // A chat runs one turn at a time, so this is a predecessor that has
        // not finished unwinding yet.
        return { kind: "wait", reason: "workspace-busy" };
      }
      const reservation = this.addReservation(appId, chatId, {
        kind: "isolated",
        workspaceId: existingWorkspaceId,
      });
      this.workspaceLocks.set(existingWorkspaceId, {
        owner: "turn",
        token: reservation.token,
      });
      this.notify(appId);
      return {
        kind: "existing-workspace",
        reservation,
        workspaceId: existingWorkspaceId,
      };
    }

    const othersWriting = this.otherWritableTurns(appId, chatId).length > 0;
    if (!othersWriting || !isolationEnabled) {
      if (this.originalIntegrationClaims.has(appId)) {
        return { kind: "wait", reason: "original-integrating" };
      }
      const reservation = this.addReservation(appId, chatId, {
        kind: "original",
      });
      this.notify(appId);
      return { kind: "original", reservation };
    }

    const reservation = this.addReservation(appId, chatId, {
      kind: "isolated",
      workspaceId: null,
    });
    this.notify(appId);
    return { kind: "new-workspace", reservation };
  }

  /** Records the workspace created for a `new-workspace` reservation. */
  bindWorkspace(reservation: WritableTurnReservation, workspaceId: number) {
    if (!this.isLive(reservation)) {
      throw new Error("Cannot bind a released workspace reservation");
    }
    reservation.creating = false;
    reservation.placement = { kind: "isolated", workspaceId };
    this.workspaceLocks.set(workspaceId, {
      owner: "turn",
      token: reservation.token,
    });
    this.notify(reservation.appId);
  }

  /**
   * Moves a pending isolated reservation back to the original directory, used
   * when the turn no longer needs isolation (for example, the other writer
   * finished while capacity was exhausted). Returns false if the original is
   * now unavailable.
   */
  fallBackToOriginal(reservation: WritableTurnReservation): boolean {
    if (!this.isLive(reservation)) return false;
    if (
      reservation.placement.kind !== "isolated" ||
      reservation.placement.workspaceId !== null
    ) {
      return false;
    }
    if (
      this.originalIntegrationClaims.has(reservation.appId) ||
      this.otherWritableTurns(reservation.appId, reservation.chatId).length > 0
    ) {
      return false;
    }
    reservation.placement = { kind: "original" };
    this.notify(reservation.appId);
    return true;
  }

  release(reservation: WritableTurnReservation): void {
    const turns = this.writableTurns.get(reservation.appId);
    if (!turns?.delete(reservation.token)) return;
    if (turns.size === 0) this.writableTurns.delete(reservation.appId);
    if (reservation.placement.kind === "isolated") {
      const workspaceId = reservation.placement.workspaceId;
      const lock =
        workspaceId === null ? undefined : this.workspaceLocks.get(workspaceId);
      if (workspaceId !== null && lock?.token === reservation.token) {
        this.workspaceLocks.delete(workspaceId);
      }
    }
    this.notify(reservation.appId);
  }

  isLive(reservation: WritableTurnReservation): boolean {
    return (
      this.writableTurns.get(reservation.appId)?.get(reservation.token) ===
      reservation
    );
  }

  /**
   * Read-only turns mark a workspace in use. Returns null while the
   * workspace is being removed; the caller then reads the original folder.
   */
  tryAddReader(appId: number, workspaceId: number): (() => void) | null {
    if (this.workspaceLocks.get(workspaceId)?.owner === "removal") return null;
    return this.addReader(appId, workspaceId);
  }

  /** Read-only turns and previews mark a workspace in use. */
  addReader(appId: number, workspaceId: number): () => void {
    this.workspaceReaders.set(
      workspaceId,
      (this.workspaceReaders.get(workspaceId) ?? 0) + 1,
    );
    this.notify(appId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.workspaceReaders.get(workspaceId) ?? 1) - 1;
      if (remaining <= 0) this.workspaceReaders.delete(workspaceId);
      else this.workspaceReaders.set(workspaceId, remaining);
      this.notify(appId);
    };
  }

  /**
   * Claims a workspace for integration work. Returns null while a turn is
   * running there; the queue retries when that turn releases.
   */
  tryClaimWorkspaceForIntegration(
    appId: number,
    workspaceId: number,
  ): (() => void) | null {
    if (this.workspaceLocks.has(workspaceId)) return null;
    const token = Symbol(`workspace-integration:${workspaceId}`);
    this.workspaceLocks.set(workspaceId, { owner: "integration", token });
    this.notify(appId);
    return () => {
      if (this.workspaceLocks.get(workspaceId)?.token !== token) return;
      this.workspaceLocks.delete(workspaceId);
      this.notify(appId);
    };
  }

  /**
   * Claims a workspace for removal. Returns null while anything uses it (a
   * turn, a reader, or integration), so a sweep that decided a workspace was
   * idle can never delete it under a turn that started in the meantime.
   */
  tryClaimWorkspaceForRemoval(
    appId: number,
    workspaceId: number,
  ): (() => void) | null {
    if (
      this.workspaceLocks.has(workspaceId) ||
      (this.workspaceReaders.get(workspaceId) ?? 0) > 0
    ) {
      return null;
    }
    const token = Symbol(`workspace-removal:${workspaceId}`);
    this.workspaceLocks.set(workspaceId, { owner: "removal", token });
    this.notify(appId);
    return () => {
      if (this.workspaceLocks.get(workspaceId)?.token !== token) return;
      this.workspaceLocks.delete(workspaceId);
      this.notify(appId);
    };
  }

  /**
   * Claims the original directory for the final fast-forward. Returns null
   * while any writable turn is using the original directory.
   */
  tryClaimOriginalForIntegration(appId: number): (() => void) | null {
    if (this.originalIntegrationClaims.has(appId)) return null;
    const usingOriginal = [
      ...(this.writableTurns.get(appId)?.values() ?? []),
    ].some((turn) => turn.placement.kind === "original");
    if (usingOriginal) return null;
    const token = Symbol(`original-integration:${appId}`);
    this.originalIntegrationClaims.set(appId, token);
    this.notify(appId);
    return () => {
      if (this.originalIntegrationClaims.get(appId) !== token) return;
      this.originalIntegrationClaims.delete(appId);
      this.notify(appId);
    };
  }

  isWorkspaceBusy(workspaceId: number): boolean {
    return (
      this.workspaceLocks.has(workspaceId) ||
      (this.workspaceReaders.get(workspaceId) ?? 0) > 0
    );
  }

  /** Whether a turn, integration step, or removal holds the workspace. */
  isWorkspaceLocked(workspaceId: number): boolean {
    return this.workspaceLocks.has(workspaceId);
  }

  isWorkspaceTurnActive(workspaceId: number): boolean {
    return this.workspaceLocks.get(workspaceId)?.owner === "turn";
  }

  /** Chats with a writable turn in progress for the app. */
  getWritableChatIds(appId: number): number[] {
    return [
      ...new Set(
        [...(this.writableTurns.get(appId)?.values() ?? [])].map(
          (turn) => turn.chatId,
        ),
      ),
    ];
  }

  /**
   * Atomically takes a capacity slot for a new workspace: succeeds only when
   * the existing workspaces plus creations already in progress leave room.
   * Waiting reservations never hold a slot, so two turns waiting at the
   * limit cannot block each other.
   */
  tryStartWorkspaceCreation(
    reservation: WritableTurnReservation,
    {
      liveWorkspaces,
      maxWorkspaces,
    }: {
      liveWorkspaces: number;
      maxWorkspaces: number;
    },
  ): boolean {
    if (!this.isLive(reservation)) return false;
    const creating = [
      ...(this.writableTurns.get(reservation.appId)?.values() ?? []),
    ].filter((turn) => turn.creating && turn !== reservation).length;
    if (liveWorkspaces + creating >= maxWorkspaces) return false;
    reservation.creating = true;
    return true;
  }

  /** Gives back a slot taken by `tryStartWorkspaceCreation` on failure. */
  abandonWorkspaceCreation(reservation: WritableTurnReservation): void {
    if (!reservation.creating) return;
    reservation.creating = false;
    this.notify(reservation.appId);
  }

  /** Resolves on the next reservation, lock, or claim change. */
  waitForChange(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onChange = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        this.changeWaiters.delete(onChange);
        reject(signal?.reason);
      };
      this.changeWaiters.add(onChange);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Observes per-app changes (used to publish renderer invalidations). */
  subscribe(listener: (appId: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private otherWritableTurns(appId: number, chatId: number) {
    return [...(this.writableTurns.get(appId)?.values() ?? [])].filter(
      (turn) => turn.chatId !== chatId,
    );
  }

  private addReservation(
    appId: number,
    chatId: number,
    placement: WritableTurnPlacement,
  ): WritableTurnReservation {
    const reservation: WritableTurnReservation = {
      token: Symbol(`writable-turn:${appId}:${chatId}`),
      appId,
      chatId,
      placement,
    };
    let turns = this.writableTurns.get(appId);
    if (!turns) {
      turns = new Map();
      this.writableTurns.set(appId, turns);
    }
    turns.set(reservation.token, reservation);
    return reservation;
  }

  private notify(appId: number) {
    this.version++;
    const waiters = [...this.changeWaiters];
    this.changeWaiters.clear();
    for (const waiter of waiters) waiter();
    for (const listener of this.listeners) {
      try {
        listener(appId);
      } catch {
        // Observers are presentation-only; never let one break reservation.
      }
    }
  }
}

export const chatWorkspaceRegistry = new ChatWorkspaceRegistry();
