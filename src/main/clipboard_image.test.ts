// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  writeImage: vi.fn(),
  ClipboardItem: undefined as
    | undefined
    | (new (data: Record<string, Blob>) => { data: Record<string, Blob> }),
}));
vi.mock("electron", () => ({
  get ClipboardItem() {
    return mocks.ClipboardItem;
  },
  clipboard: { write: mocks.write, writeImage: mocks.writeImage },
}));
import { writeClipboardImage } from "./clipboard_image";
const bytes = Buffer.from([137, 80, 78, 71, 0, 255]);
const image = { toPNG: () => bytes } as Electron.NativeImage;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.ClipboardItem = undefined;
});
it("writes a NativeImage on Electron 40", async () => {
  await writeClipboardImage(image);
  expect(mocks.writeImage).toHaveBeenCalledWith(image);
  expect(mocks.write).not.toHaveBeenCalled();
});
it("writes exact PNG bytes and waits for the modern clipboard", async () => {
  mocks.ClipboardItem = class {
    constructor(public data: Record<string, Blob>) {}
  };
  let finish!: () => void;
  mocks.write.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  let complete = false;
  const pending = writeClipboardImage(image).then(() => {
    complete = true;
  });
  const item = mocks.write.mock.calls[0][0][0];
  expect(item.data["image/png"].type).toBe("image/png");
  expect(Buffer.from(await item.data["image/png"].arrayBuffer())).toEqual(
    bytes,
  );
  expect(complete).toBe(false);
  finish();
  await pending;
  expect(mocks.writeImage).not.toHaveBeenCalled();
});
it("propagates clipboard failure so the caller retains its capture", async () => {
  mocks.ClipboardItem = class {
    constructor(public data: Record<string, Blob>) {}
  };
  mocks.write.mockRejectedValue(new Error("clipboard unavailable"));
  await expect(writeClipboardImage(image)).rejects.toThrow(
    "clipboard unavailable",
  );
});
