import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren,
} from "react";
import { PreparedRequestScope } from "@/distributed_machines/prepared_request";
import { useManagerLifecycle } from "@/state_machines/react";

const ImageGenerationRequestScopeContext =
  createContext<PreparedRequestScope | null>(null);

export function ImageGenerationRequestScopeProvider({
  children,
}: PropsWithChildren) {
  const [scope] = useState(
    () =>
      new PreparedRequestScope(
        `image-generation-window:${globalThis.crypto.randomUUID()}`,
      ),
  );
  useManagerLifecycle(scope);
  return (
    <ImageGenerationRequestScopeContext.Provider value={scope}>
      {children}
    </ImageGenerationRequestScopeContext.Provider>
  );
}

export function useImageGenerationRequestScope(): PreparedRequestScope {
  const scope = useContext(ImageGenerationRequestScopeContext);
  if (!scope) {
    throw new Error(
      "useImageGenerationRequestScope requires ImageGenerationProvider",
    );
  }
  return scope;
}
