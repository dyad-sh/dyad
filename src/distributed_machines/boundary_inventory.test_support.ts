export const unsafeEscapeHatchInventory = {
  wideningCasts: [
    "app_run/definition.ts#1",
    "chat_stream/definition.ts#1",
    "ipc/services/github_ops_definition.ts#1",
    "ipc/services/image_generation_definition.ts#1",
    "ipc/services/version_preview_definition.ts#1",
    "plan_handoff/definition.ts#1",
  ],
  rawDispatchOrEnqueue: [
    "app_run/definition.ts#1",
    "app_run/remote_manager.ts#3",
    "chat_stream/remote_manager.ts#3",
    "distributed_machines/actor_host.ts#5",
    "distributed_machines/ipc_connection.ts#1",
    "distributed_machines/remote_client.ts#2",
    "distributed_machines/remote_transport.ts#1",
    "github_ops/useGithubOps.ts#3",
    "hooks/useGenerateImage.ts#2",
    "hooks/useVersionPreview.ts#1",
    "ipc/handlers/distributed_machine_handlers.ts#1",
    "ipc/services/app_run_actor_service.ts#1",
    "ipc/services/image_generation_actor_service.ts#1",
    "ipc/services/plan_handoff_service.ts#1",
    "plan_handoff/remote_manager.ts#1",
    "version_preview/VersionPreviewProvider.tsx#1",
  ],
  bespokeWaiters: [
    "app_run/remote_manager.ts#16",
    "hooks/useVersionPreview.ts#5",
    "ipc/services/app_run_actor_service.ts#2",
  ],
  subscriptionRefCounts: [
    "app_run/remote_manager.ts#4",
    "chat_stream/remote_manager.ts#1",
    "distributed_machines/actor_host.ts#6",
    "distributed_machines/remote_transport.ts#11",
    "state_machines/snapshot_store.ts#1",
  ],
  deletionResetFences: [
    "ipc/services/app_chat_creation_fence.ts#7",
    "ipc/services/chat_actor_deletion_fence.ts#7",
    "ipc/services/github_ops_service.ts#12",
    "ipc/services/image_generation_service.ts#12",
    "ipc/services/version_preview_service.ts#12",
  ],
  initiatorRoutingMaps: [
    "ipc/services/github_ops_presentation_service.ts#7",
    "ipc/services/image_generation_presentation_service.ts#10",
    "ipc/services/version_preview_presentation_service.ts#10",
    "ipc/services/version_preview_window_interest.ts#13",
  ],
} as const;

/**
 * Exact negative classification used to make raw dispatch discovery
 * re-export-safe. These calls are unrelated queues or domain facades, so they
 * stay out of the unsafe escape-hatch report while remaining pinned.
 */
export const nonRemoteDispatchOrEnqueueInventory = [
  "hooks/useRunApp.ts#4",
  "ipc/services/app_runtime_service.ts#2",
  "ipc/services/app_runtime_transport.ts#1",
  "ipc/services/main_app_runtime_output.ts#1",
  "ipc/utils/debug_fetch.ts#1",
  "ipc/utils/fallback_ai_model.ts#1",
  "state_machines/dispatcher.ts#1",
  "supabase_admin/supabase_deploy_queue.ts#1",
  "version_preview/window_interest_client.ts#3",
  "window_infrastructure/main/high_volume_interests.ts#1",
] as const;
