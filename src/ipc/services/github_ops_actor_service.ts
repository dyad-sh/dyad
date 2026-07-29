import type { ActorMachineFenceHandle } from "@/distributed_machines/actor_host";
import type { FenceHandle } from "@/distributed_machines/keyed_admission_gate";
import { githubOpsKey, type GithubOpsWireEvent } from "@/github_ops/transport";
import { remoteMachineHost } from "./distributed_machine_host";
import { githubOpsDefinition } from "./github_ops_definition";
import { githubOpsOperationService } from "./github_ops_operation_service";

type GithubOpsActorHost = Pick<
  typeof remoteMachineHost,
  "disposeKey" | "disposeMachine" | "beginFence" | "beginMachineFence"
>;

function isGithubOpsDrainEvent(event: GithubOpsWireEvent): boolean {
  switch (event.type) {
    case "OP_SUCCEEDED":
    case "OP_FAILED":
    case "CONFLICTS":
    case "GIT_STATE":
    case "CONFLICT_RESOLUTION_CLAIM_EXPIRED":
      return true;
    case "OP_REQUESTED":
    case "ABORT_AND_SWITCH_CONFIRMED":
    case "BLOCKED_DISMISSED":
    case "RESOLVE_WITH_AI_STARTED":
    case "BANNER_DISMISSED":
    case "RECONCILE_REQUESTED":
    case "CONFLICT_RESOLUTION_STARTED":
    case "CONFLICT_RESOLUTION_CANCELLED":
      return false;
  }
}

export class GithubOpsActorService {
  constructor(private readonly host: GithubOpsActorHost = remoteMachineHost) {}

  beginAppDeletion(
    appId: number,
  ): FenceHandle<ReturnType<typeof githubOpsKey>> {
    return this.host.beginFence(githubOpsDefinition, {
      key: githubOpsKey(appId),
      allowDuringDrain: isGithubOpsDrainEvent,
    });
  }

  beginReset(): ActorMachineFenceHandle {
    return this.host.beginMachineFence(githubOpsDefinition, {
      allowDuringDrain: (event) =>
        isGithubOpsDrainEvent(event as GithubOpsWireEvent),
    });
  }

  async disposeApp(appId: number): Promise<void> {
    githubOpsOperationService.settleKey(String(appId));
    await this.host.disposeKey(
      githubOpsDefinition.id,
      githubOpsKey(appId),
      "entity-deletion",
    );
  }

  disposeAllApps(): Promise<void> {
    githubOpsOperationService.settleMachine();
    return this.host.disposeMachine(githubOpsDefinition.id);
  }
}

export const githubOpsActorService = new GithubOpsActorService();
