import { rendererExtensionManager } from "@/extensions/core/renderer_extension_manager";
import type { ExtensionMetadata } from "@/hooks/useExtensions";

interface ExtensionConnectorProps {
  extension: ExtensionMetadata;
  appId: number;
  folderName: string;
}

/**
 * Component to render extension app connector integration
 */
export function ExtensionConnector({
  extension,
  appId,
  folderName,
}: ExtensionConnectorProps) {
  if (!extension.ui?.appConnector) {
    return null;
  }

  const Component = rendererExtensionManager.getComponent(
    extension.id,
    extension.ui.appConnector.component,
  );

  if (!Component) {
    return null;
  }

  // Pass standard props that connectors typically need
  return <Component appId={appId} folderName={folderName} />;
}
