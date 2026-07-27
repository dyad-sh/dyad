import { githubOpsKey } from "@/github_ops/transport";
import { remoteMachineHost } from "./distributed_machine_host";
import { githubOpsDefinition } from "./github_ops_definition";

type GithubOpsActorHost = Pick<
  typeof remoteMachineHost,
  "disposeKey" | "disposeMachine"
>;

export class GithubOpsActorService {
  constructor(private readonly host: GithubOpsActorHost = remoteMachineHost) {}

  disposeApp(appId: number): Promise<void> {
    return this.host.disposeKey(
      githubOpsDefinition.id,
      githubOpsKey(appId),
      "entity-deletion",
    );
  }

  disposeAllApps(): Promise<void> {
    return this.host.disposeMachine(githubOpsDefinition.id);
  }
}

export const githubOpsActorService = new GithubOpsActorService();
