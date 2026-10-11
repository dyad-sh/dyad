import { isAppPreviewHostname } from "../../../shared/preview_hostname";

export async function resolvePreviewBrowserUrl(input: {
  isCloudMode: boolean;
  selectedAppId: number | null;
  appUrl: string | null | undefined;
  originalUrl: string | null | undefined;
  createCloudSandboxShareLink: (params: {
    appId: number;
  }) => Promise<{ url: string }>;
}): Promise<string> {
  if (input.isCloudMode) {
    if (input.selectedAppId === null) {
      throw new Error("Cloud sandbox is not running.");
    }

    const shareLink = await input.createCloudSandboxShareLink({
      appId: input.selectedAppId,
    });
    return shareLink.url;
  }

  if (!input.appUrl) {
    throw new Error("Preview URL is unavailable.");
  }

  if (isAppPreviewHostname(new URL(input.appUrl).hostname)) {
    // The app-specific proxy rejects localhost on its port. Open the underlying
    // dev server so external browsers use a regular localhost origin.
    if (!input.originalUrl) {
      throw new Error("Dev server URL is unavailable.");
    }
    return input.originalUrl;
  }

  return input.appUrl;
}
