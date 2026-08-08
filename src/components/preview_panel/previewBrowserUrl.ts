export async function resolvePreviewBrowserUrl(input: {
  isCloudMode: boolean;
  selectedAppId: number | null;
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

  if (!input.originalUrl) {
    throw new Error("Preview URL is unavailable.");
  }

  return input.originalUrl;
}
