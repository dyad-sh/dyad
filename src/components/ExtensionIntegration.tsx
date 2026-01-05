import { rendererExtensionManager } from "@/extensions/core/renderer_extension_manager";
import type { ExtensionMetadata } from "@/hooks/useExtensions";

interface ExtensionIntegrationProps {
  extension: ExtensionMetadata;
}

/**
 * Component to render extension settings page integration
 */
export function ExtensionIntegration({ extension }: ExtensionIntegrationProps) {
  if (!extension.ui?.settingsPage) {
    return null;
  }

  const Component = rendererExtensionManager.getComponent(
    extension.id,
    extension.ui.settingsPage.component,
  );

  if (!Component) {
    return null;
  }

  return <Component />;
}
