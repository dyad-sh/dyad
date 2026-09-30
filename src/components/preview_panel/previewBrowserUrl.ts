export const LOCAL_PREVIEW_BROWSER_HINT =
  "If this address does not load in your browser, open it in Chrome or Firefox. Older Safari versions may not resolve app preview addresses.";

export async function resolvePreviewBrowserUrl(input: {
  isCloudMode: boolean;
  selectedAppId: number | null;
  appUrl: string | null | undefined;
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

  return input.appUrl;
}
