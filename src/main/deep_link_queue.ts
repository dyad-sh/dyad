type DeepLinkHandler = (url: string) => void | Promise<void>;

export function createDeepLinkQueue(handler: DeepLinkHandler) {
  let isReady = false;
  const queuedUrls: string[] = [];

  return {
    handle(url: string) {
      if (!isReady) {
        queuedUrls.push(url);
        return;
      }

      void handler(url);
    },

    markReady() {
      if (isReady) {
        return;
      }

      isReady = true;
      const urls = queuedUrls.splice(0);
      for (const url of urls) {
        void handler(url);
      }
    },
  };
}
