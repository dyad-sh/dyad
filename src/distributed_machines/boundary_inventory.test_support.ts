export interface BoundaryOwnership {
  readonly exactFile: string;
  readonly expectedCount: number;
}

export type CompatibilityMechanism =
  | "wideningCasts"
  | "rawDispatchOrEnqueue"
  | "bespokeWaiters"
  | "subscriptionRefCounts"
  | "deletionResetFences"
  | "initiatorRoutingMaps";

export interface CompatibilityBoundaryEntry extends BoundaryOwnership {
  readonly machine: string;
  readonly mechanism: CompatibilityMechanism;
  readonly why: string;
  readonly removalOwner: string;
}

const owned = (
  exactFile: string,
  expectedCount: number,
): BoundaryOwnership => ({
  exactFile,
  expectedCount,
});

export const distributedDefinitionInventory = [
  "app_run/definition.ts::appRunDefinition",
  "chat_stream/definition.ts::chatStreamDefinition",
  "ipc/services/github_ops_definition.ts::githubOpsDefinition",
  "ipc/services/image_generation_definition.ts::imageGenerationDefinition",
  "ipc/services/version_preview_definition.ts::versionPreviewDefinition",
  "plan_handoff/definition.ts::planHandoffDefinition",
] as const;

/**
 * Exact compatibility ownership is intentionally stable across function and
 * class refactors. The AST tests still discover every boundary, but compare
 * the owning file and count instead of encoding incidental enclosing names.
 * Adding or removing a boundary changes the count; moving or renaming the file
 * changes the exact path.
 */
export const compatibilityBoundaryInventory = [
  {
    machine: "chat_stream",
    exactFile: "chat_stream/definition.ts",
    mechanism: "wideningCasts",
    expectedCount: 1,
    why: "The protocol-v1 codec still widens renderer intents to trusted events.",
    removalOwner: "Conditional follow-up A — remaining remote definitions",
  },
  {
    machine: "chat_stream",
    exactFile: "chat_stream/remote_manager.ts",
    mechanism: "rawDispatchOrEnqueue",
    expectedCount: 3,
    why: "Chat keeps its pre-MVP owned queue and remote-manager adapter.",
    removalOwner: "Conditional follow-up C — chat/plan owned queue",
  },
  {
    machine: "chat_stream",
    exactFile: "chat_stream/remote_manager.ts",
    mechanism: "subscriptionRefCounts",
    expectedCount: 1,
    why: "Chat subscription ownership has not migrated to leases.",
    removalOwner: "Conditional follow-up A — remaining remote definitions",
  },
  {
    machine: "github_ops",
    exactFile: "ipc/services/github_ops_definition.ts",
    mechanism: "wideningCasts",
    expectedCount: 1,
    why: "The protocol-v1 codec still widens renderer intents to trusted events.",
    removalOwner: "Conditional follow-up A — GitHub operations",
  },
  {
    machine: "github_ops",
    exactFile: "github_ops/useGithubOps.ts",
    mechanism: "rawDispatchOrEnqueue",
    expectedCount: 6,
    why: "GitHub operations were explicitly excluded from the MVP pilots.",
    removalOwner: "Conditional follow-up A — GitHub operations",
  },
  {
    machine: "version_preview",
    exactFile: "ipc/services/version_preview_definition.ts",
    mechanism: "wideningCasts",
    expectedCount: 1,
    why: "The protocol-v1 codec still widens renderer intents to trusted events.",
    removalOwner: "Conditional follow-up A — version-preview ownership",
  },
  {
    machine: "version_preview",
    exactFile: "hooks/useVersionPreview.ts",
    mechanism: "bespokeWaiters",
    expectedCount: 1,
    why: "Version preview still owns its protocol-v1 settlement waiters.",
    removalOwner: "Conditional follow-up A — version-preview ownership",
  },
  {
    machine: "version_preview",
    exactFile: "hooks/useVersionPreview.ts",
    mechanism: "rawDispatchOrEnqueue",
    expectedCount: 1,
    why: "Version preview still uses its protocol-v1 dispatch façade.",
    removalOwner: "Conditional follow-up A — version-preview ownership",
  },
  {
    machine: "version_preview",
    exactFile: "version_preview/VersionPreviewProvider.tsx",
    mechanism: "rawDispatchOrEnqueue",
    expectedCount: 1,
    why: "Version preview presentation still emits a raw compatibility intent.",
    removalOwner: "Conditional follow-up A — version-preview ownership",
  },
  {
    machine: "plan_handoff",
    exactFile: "plan_handoff/definition.ts",
    mechanism: "wideningCasts",
    expectedCount: 1,
    why: "The protocol-v1 codec still widens renderer intents to trusted events.",
    removalOwner: "Conditional follow-up B/C — plan handoff",
  },
  {
    machine: "plan_handoff",
    exactFile: "plan_handoff/remote_manager.ts",
    mechanism: "rawDispatchOrEnqueue",
    expectedCount: 1,
    why: "Plan handoff was excluded until durable checkpoint work.",
    removalOwner: "Conditional follow-up B/C — plan handoff",
  },
  {
    machine: "plan_handoff",
    exactFile: "ipc/services/plan_handoff_service.ts",
    mechanism: "rawDispatchOrEnqueue",
    expectedCount: 1,
    why: "Main-owned plan handoff still uses protocol-v1 actor enqueue.",
    removalOwner: "Conditional follow-up B/C — plan handoff",
  },
  {
    machine: "user_input",
    exactFile: "user_input/read_model.ts",
    mechanism: "subscriptionRefCounts",
    expectedCount: 1,
    why: "User-input queue ownership is outside the MVP.",
    removalOwner: "Conditional follow-up C — chat/plan owned queue",
  },
  {
    machine: "app_chat_creation",
    exactFile: "ipc/services/app_chat_creation_fence.ts",
    mechanism: "deletionResetFences",
    expectedCount: 3,
    why: "Chat creation has not migrated to keyed admission.",
    removalOwner: "Conditional follow-up C — chat/plan owned queue",
  },
  {
    machine: "chat_stream",
    exactFile: "ipc/services/chat_actor_deletion_fence.ts",
    mechanism: "deletionResetFences",
    expectedCount: 3,
    why: "Chat deletion has not migrated to keyed admission.",
    removalOwner: "Conditional follow-up C — chat/plan owned queue",
  },
  {
    machine: "github_ops",
    exactFile: "ipc/services/github_ops_service.ts",
    mechanism: "deletionResetFences",
    expectedCount: 8,
    why: "GitHub operations retain domain-owned deletion/reset counters.",
    removalOwner: "Conditional follow-up A — GitHub operations",
  },
  {
    machine: "version_preview",
    exactFile: "ipc/services/version_preview_service.ts",
    mechanism: "deletionResetFences",
    expectedCount: 8,
    why: "Version preview retains domain-owned deletion/reset counters.",
    removalOwner: "Conditional follow-up A — version-preview ownership",
  },
  {
    machine: "github_ops",
    exactFile: "ipc/services/github_ops_presentation_service.ts",
    mechanism: "initiatorRoutingMaps",
    expectedCount: 4,
    why: "GitHub presentation routing predates correlated operation ownership.",
    removalOwner: "Conditional follow-up A — GitHub operations",
  },
  {
    machine: "version_preview",
    exactFile: "ipc/services/version_preview_presentation_service.ts",
    mechanism: "initiatorRoutingMaps",
    expectedCount: 5,
    why: "Version preview presentation still owns an operation route map.",
    removalOwner: "Conditional follow-up A — version-preview ownership",
  },
  {
    machine: "version_preview",
    exactFile: "ipc/services/version_preview_window_interest.ts",
    mechanism: "initiatorRoutingMaps",
    expectedCount: 9,
    why: "Version preview window interest has not migrated to shared leases.",
    removalOwner: "Conditional follow-up A — version-preview ownership",
  },
] as const satisfies readonly CompatibilityBoundaryEntry[];

export const unsafeEscapeHatchInventory = {
  wideningCasts: compatibilityBoundaryInventory.filter(
    ({ mechanism }) => mechanism === "wideningCasts",
  ),
  rawDispatchOrEnqueue: compatibilityBoundaryInventory.filter(
    ({ mechanism }) => mechanism === "rawDispatchOrEnqueue",
  ),
  bespokeWaiters: compatibilityBoundaryInventory.filter(
    ({ mechanism }) => mechanism === "bespokeWaiters",
  ),
  subscriptionRefCounts: compatibilityBoundaryInventory.filter(
    ({ mechanism }) => mechanism === "subscriptionRefCounts",
  ),
  deletionResetFences: compatibilityBoundaryInventory.filter(
    ({ mechanism }) => mechanism === "deletionResetFences",
  ),
  initiatorRoutingMaps: compatibilityBoundaryInventory.filter(
    ({ mechanism }) => mechanism === "initiatorRoutingMaps",
  ),
} satisfies Record<
  CompatibilityMechanism,
  readonly CompatibilityBoundaryEntry[]
>;

/**
 * Framework-owned ingress and accounting. New calls within these exact
 * framework files remain visible through count changes without coupling the
 * inventory to private method names.
 */
export const frameworkOwnedBoundaryInventory = {
  rawDispatchOrEnqueue: [
    owned("distributed_machines/actor_host.ts", 5),
    owned("distributed_machines/ipc_connection.ts", 1),
    owned("distributed_machines/react.ts", 1),
    owned("distributed_machines/remote_client.ts", 2),
    owned("ipc/handlers/distributed_machine_handlers.ts", 2),
  ],
  subscriptionRefCounts: [
    owned("distributed_machines/actor_host.ts", 4),
    owned("distributed_machines/remote_transport.ts", 7),
    owned("state_machines/snapshot_store.ts", 1),
  ],
} as const;

/**
 * Narrow audited pilot composition roots. Ordinary migrated callers remain
 * prohibited; these exact files own the remaining internal adapters.
 */
export const migratedSurfaceBoundaryInventory = {
  wideningCasts: [
    owned("app_run/definition.ts", 1),
    owned("ipc/services/image_generation_definition.ts", 1),
  ],
  rawDispatchOrEnqueue: [
    owned("app_run/definition.ts", 1),
    owned("image_generation/hooks.ts", 2),
    owned("ipc/services/image_generation_actor_service.ts", 2),
  ],
  deletionResetFences: [owned("ipc/services/image_generation_service.ts", 8)],
  initiatorRoutingMaps: [
    owned("ipc/services/image_generation_presentation_service.ts", 6),
  ],
} as const;

/**
 * False-positive method names that are unrelated to distributed-machine
 * transport. Exact files and counts prevent this exclusion from becoming a
 * wildcard.
 */
export const nonRemoteDispatchOrEnqueueInventory = [
  // A local main-process machine: dispatch here is its own transition, not
  // distributed-machine transport.
  owned("coolify_deploy/controller.ts", 7),
  owned("coolify_setup/controller.ts", 6),
  owned("hooks/useRunApp.ts", 1),
  owned("ipc/services/app_runtime_service.ts", 2),
  owned("ipc/services/app_runtime_transport.ts", 1),
  owned("ipc/services/main_app_runtime_output.ts", 1),
  owned("ipc/utils/debug_fetch.ts", 1),
  owned("ipc/utils/fallback_ai_model.ts", 1),
  owned("state_machines/dispatcher.ts", 1),
  owned("supabase_admin/supabase_deploy_queue.ts", 1),
  owned("version_preview/window_interest_client.ts", 3),
  owned("window_infrastructure/main/high_volume_interests.ts", 1),
] as const;

/**
 * Framework request paths that are correlated or explicitly admission-only.
 */
export const completionAwareDispatchOrEnqueueInventory = [
  owned("app_run/definition.ts", 1),
  owned("distributed_machines/operation_registry.ts", 2),
  owned("distributed_machines/prepared_request.ts", 1),
  owned("distributed_machines/request_actor.ts", 3),
  owned("distributed_machines/use_machine_mutation.ts", 1),
  owned("ipc/services/app_run_actor_service.ts", 1),
] as const;

/**
 * Only creation capability use on a migrated surface. Creation elsewhere is
 * outside PR9's migrated-surface guarantee and is not pinned call by call.
 */
export const migratedActorEnsureInventory = [
  owned("ipc/services/app_run_actor_service.ts", 1),
] as const;

/**
 * Stateful collections remain growth-sensitive but stable across private
 * member/function renames. This is a coarse backstop; semantic waiter,
 * subscription, fence, and routing collectors remain the primary checks.
 */
export const migratedStatefulOwnerInventory = [
  owned("app_run/remote_manager.ts", 1),
  owned("app_run/transport.ts", 1),
  owned("hooks/useRunApp.ts", 1),
  owned("image_generation/selectors.ts", 1),
  owned("ipc/services/app_runtime_service.ts", 3),
  owned("ipc/services/app_runtime_transport.ts", 1),
  owned("ipc/services/image_generation_definition.ts", 1),
  owned("ipc/services/image_generation_presentation_service.ts", 2),
  owned("ipc/services/image_generation_service.ts", 3),
] as const;
