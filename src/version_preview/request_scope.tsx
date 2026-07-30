import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren,
} from "react";
import { PreparedRequestScope } from "@/distributed_machines/prepared_request";
import { useManagerLifecycle } from "@/state_machines/react";

const VersionPreviewRequestScopeContext =
  createContext<PreparedRequestScope | null>(null);

export function VersionPreviewRequestScopeProvider({
  children,
  scope: providedScope,
}: PropsWithChildren<{ readonly scope?: PreparedRequestScope }>) {
  if (providedScope) {
    return (
      <VersionPreviewRequestScopeContext.Provider value={providedScope}>
        {children}
      </VersionPreviewRequestScopeContext.Provider>
    );
  }
  return (
    <OwnedVersionPreviewRequestScope>
      {children}
    </OwnedVersionPreviewRequestScope>
  );
}

function OwnedVersionPreviewRequestScope({ children }: PropsWithChildren) {
  const [ownedScope] = useState(
    () =>
      new PreparedRequestScope(
        `version-preview-window:${globalThis.crypto.randomUUID()}`,
      ),
  );
  useManagerLifecycle(ownedScope);
  return (
    <VersionPreviewRequestScopeContext.Provider value={ownedScope}>
      {children}
    </VersionPreviewRequestScopeContext.Provider>
  );
}

export function useVersionPreviewRequestScope(): PreparedRequestScope {
  const scope = useContext(VersionPreviewRequestScopeContext);
  if (!scope) {
    throw new Error(
      "useVersionPreviewRequestScope requires VersionPreviewProvider",
    );
  }
  return scope;
}
