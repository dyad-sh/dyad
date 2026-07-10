import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const screenshotClientSource = fs.readFileSync(
  path.resolve(process.cwd(), "worker/dyad-screenshot-client.js"),
  "utf8",
);

type Dimensions = {
  width: number;
  height: number;
};

function loadScreenshotClient({
  fullPage,
  viewport,
  devicePixelRatio = 1,
}: {
  fullPage: Dimensions;
  viewport: Dimensions;
  devicePixelRatio?: number;
}) {
  let messageHandler:
    | ((event: { source: object; data: Record<string, unknown> }) => void)
    | undefined;
  const parent = { postMessage: vi.fn() };
  const toPng = vi.fn().mockResolvedValue("data:image/png;base64,test");
  const window = {
    parent,
    innerWidth: viewport.width,
    innerHeight: viewport.height,
    devicePixelRatio,
    addEventListener: vi.fn(
      (
        eventName: string,
        handler: (event: {
          source: object;
          data: Record<string, unknown>;
        }) => void,
      ) => {
        if (eventName === "message") {
          messageHandler = handler;
        }
      },
    ),
  };
  const documentElement = {
    scrollWidth: fullPage.width,
    scrollHeight: fullPage.height,
    offsetWidth: fullPage.width,
    offsetHeight: fullPage.height,
    clientWidth: viewport.width,
    clientHeight: viewport.height,
  };
  const body = {
    ...documentElement,
    clientWidth: viewport.width,
    clientHeight: viewport.height,
  };

  vm.runInNewContext(screenshotClientSource, {
    console: {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
    document: { body, documentElement },
    htmlToImage: { toPng },
    window,
  });

  if (!messageHandler) {
    throw new Error("Screenshot client did not register its message handler");
  }

  return {
    parent,
    toPng,
    dispatchScreenshot(requestId: string) {
      messageHandler?.({
        source: parent,
        data: { type: "dyad-take-screenshot", requestId },
      });
    },
    async requestScreenshot() {
      this.dispatchScreenshot("request-1");
      await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalled());
    },
  };
}

describe("dyad screenshot client", () => {
  it("preserves a normal full-page screenshot within the memory budget", async () => {
    const client = loadScreenshotClient({
      fullPage: { width: 1200, height: 3000 },
      viewport: { width: 1200, height: 800 },
      devicePixelRatio: 3,
    });

    await client.requestScreenshot();

    expect(client.toPng).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        width: 1200,
        height: 3000,
        pixelRatio: 1,
      }),
    );
  });

  it("uses a bounded viewport for a page that is too tall", async () => {
    const client = loadScreenshotClient({
      fullPage: { width: 1920, height: 50_000 },
      viewport: { width: 1280, height: 720 },
    });

    await client.requestScreenshot();

    const options = client.toPng.mock.calls[0][1] as {
      width: number;
      height: number;
      pixelRatio: number;
    };
    expect(options).toEqual({ width: 1280, height: 720, pixelRatio: 1 });
    expect(options.width * options.height).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it("reuses one canvas for concurrent screenshot requests", async () => {
    const client = loadScreenshotClient({
      fullPage: { width: 1200, height: 2000 },
      viewport: { width: 1200, height: 800 },
    });

    client.dispatchScreenshot("request-1");
    client.dispatchScreenshot("request-2");

    expect(client.toPng).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(client.parent.postMessage).toHaveBeenCalledTimes(2),
    );
  });
});
