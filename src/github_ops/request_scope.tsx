import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren,
} from "react";
import { PreparedRequestScope } from "@/distributed_machines/prepared_request";
import { useManagerLifecycle } from "@/state_machines/react";

const GithubOpsRequestScopeContext = createContext<PreparedRequestScope | null>(
  null,
);

export function GithubOpsRequestScopeProvider({ children }: PropsWithChildren) {
  const [scope] = useState(
    () =>
      new PreparedRequestScope(
        `github-operations-window:${globalThis.crypto.randomUUID()}`,
      ),
  );
  useManagerLifecycle(scope);
  return (
    <GithubOpsRequestScopeContext.Provider value={scope}>
      {children}
    </GithubOpsRequestScopeContext.Provider>
  );
}

export function useGithubOpsRequestScope(): PreparedRequestScope {
  const scope = useContext(GithubOpsRequestScopeContext);
  if (!scope) {
    throw new Error(
      "useGithubOpsRequestScope requires GithubOpsRequestScopeProvider",
    );
  }
  return scope;
}
