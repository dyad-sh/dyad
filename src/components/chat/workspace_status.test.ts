import { describe, expect, it } from "vitest";
import type { AppWorkspaceOverview, ChatWorkspaceStatus } from "@/ipc/types";
import {
  canDeleteChatWorkspace,
  integrationStatusKey,
  integrationTone,
  shouldShowConcurrentChatBanner,
  shouldShowNpmWorktreeBanner,
  shouldShowWorkspaceIndicator,
} from "./workspace_status";

const overview = (
  overrides: Partial<AppWorkspaceOverview> = {},
): AppWorkspaceOverview => ({
  appId: 1,
  isolationEnabled: false,
  writableChatIds: [],
  workspaces: [],
  ...overrides,
});

const status = (
  overrides: Partial<ChatWorkspaceStatus> = {},
): ChatWorkspaceStatus => ({
  chatId: 5,
  appId: 1,
  kind: "original",
  branch: "main",
  targetBranch: null,
  workspaceId: null,
  runtimeAppId: 1,
  writableTurnRunning: false,
  hasUnmergedWork: false,
  packageManager: null,
  integration: null,
  ...overrides,
});

describe("workspace status presentation", () => {
  it("labels integration separately from agent completion", () => {
    expect(integrationStatusKey("queued")).toBe("statusQueued");
    expect(integrationStatusKey("resolving-conflicts")).toBe(
      "statusResolvingConflicts",
    );
    expect(integrationStatusKey("validating")).toBe("statusValidating");
    expect(integrationStatusKey("merged")).toBe("statusMerged");
    expect(integrationStatusKey("idle")).toBeNull();
    expect(integrationTone("merged")).toBe("success");
    expect(integrationTone("failed")).toBe("attention");
    expect(integrationTone("integrating")).toBe("progress");
  });

  it("shows the branch indicator only for the isolation feature", () => {
    expect(shouldShowWorkspaceIndicator(status(), false)).toBe(false);
    expect(shouldShowWorkspaceIndicator(status(), true)).toBe(true);
    // An existing workspace keeps showing after isolation is turned off.
    expect(
      shouldShowWorkspaceIndicator(status({ kind: "isolated" }), false),
    ).toBe(true);
    expect(shouldShowWorkspaceIndicator(undefined, true)).toBe(false);
  });

  it("warns only when another chat is writing and isolation is off", () => {
    const base = {
      chatId: 5,
      isolationEnabled: false,
      dismissedAppIds: new Set<number>(),
    };
    expect(
      shouldShowConcurrentChatBanner({
        ...base,
        overview: overview({ writableChatIds: [7] }),
      }),
    ).toBe(true);
    // The current chat's own turn is not "another chat".
    expect(
      shouldShowConcurrentChatBanner({
        ...base,
        overview: overview({ writableChatIds: [5] }),
      }),
    ).toBe(false);
    expect(
      shouldShowConcurrentChatBanner({
        ...base,
        isolationEnabled: true,
        overview: overview({ writableChatIds: [7] }),
      }),
    ).toBe(false);
    expect(
      shouldShowConcurrentChatBanner({
        ...base,
        dismissedAppIds: new Set([1]),
        overview: overview({ writableChatIds: [7] }),
      }),
    ).toBe(false);
  });

  it("warns about disk use only for a chat whose worktree installs with npm", () => {
    const npm = status({ kind: "isolated", packageManager: "npm" });
    const none = new Set<number>();
    expect(
      shouldShowNpmWorktreeBanner({
        status: npm,
        chatId: 5,
        dismissedAppIds: none,
      }),
    ).toBe(true);
    // pnpm shares packages; unknown or the main folder has nothing to warn about.
    for (const other of [
      status({ kind: "isolated", packageManager: "pnpm" }),
      status({ kind: "isolated", packageManager: null }),
      status({ kind: "original" }),
    ]) {
      expect(
        shouldShowNpmWorktreeBanner({
          status: other,
          chatId: 5,
          dismissedAppIds: none,
        }),
      ).toBe(false);
    }
    // A stale status for another chat, or a dismissal for this app, hides it.
    expect(
      shouldShowNpmWorktreeBanner({
        status: npm,
        chatId: 6,
        dismissedAppIds: none,
      }),
    ).toBe(false);
    expect(
      shouldShowNpmWorktreeBanner({
        status: npm,
        chatId: 5,
        dismissedAppIds: new Set([1]),
      }),
    ).toBe(false);
  });

  it("allows deleting a worktree, merged or not, unless Dyad is working in it", () => {
    const withPhase = (
      phase: NonNullable<ChatWorkspaceStatus["integration"]>["phase"],
    ) =>
      status({
        kind: "isolated",
        integration: { phase, detail: null, validation: null, canRetry: false },
      });
    expect(canDeleteChatWorkspace(status({ kind: "original" }))).toBe(false);
    expect(canDeleteChatWorkspace(status({ kind: "isolated" }))).toBe(true);
    for (const phase of [
      "idle",
      "queued",
      "merged",
      "paused",
      "failed",
    ] as const) {
      expect(canDeleteChatWorkspace(withPhase(phase))).toBe(true);
    }
    for (const phase of [
      "merging",
      "resolving-conflicts",
      "validating",
      "integrating",
    ] as const) {
      expect(canDeleteChatWorkspace(withPhase(phase))).toBe(false);
    }
    expect(
      canDeleteChatWorkspace(
        status({ kind: "isolated", writableTurnRunning: true }),
      ),
    ).toBe(false);
  });
});
