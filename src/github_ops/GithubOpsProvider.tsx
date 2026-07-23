import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createMachineProvider,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { GithubOpsCommandRunner } from "./commands";
import { GithubOpsManager } from "./manager";

function useOwnedGithubOpsManager(): GithubOpsManager {
  const queryClient = useQueryClient();
  const [manager] = useState(
    () => new GithubOpsManager(new GithubOpsCommandRunner(queryClient)),
  );
  return manager;
}

function useGithubOpsMount(manager: GithubOpsManager): void {
  useRegisterEntityDisposer("app", manager.disposeKey);
}

const githubOpsProvider = createMachineProvider({
  name: "GithubOps",
  useOwnedManager: useOwnedGithubOpsManager,
  useOnMount: useGithubOpsMount,
});

export const GithubOpsProvider = githubOpsProvider.Provider;
export const useGithubOpsManager = githubOpsProvider.useManager;
