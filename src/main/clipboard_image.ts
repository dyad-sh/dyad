import * as electron from "electron";

// Electron 44 replaces writeImage with the asynchronous W3C-style API.
// Keep this adapter usable on the preparation release (Electron 40) too.
interface ModernClipboard {
  ClipboardItem: new (data: Record<string, Blob>) => unknown;
  clipboard: { write(items: unknown[]): Promise<void> };
}
export async function writeClipboardImage(
  image: Electron.NativeImage,
): Promise<void> {
  const modern = electron as unknown as Partial<ModernClipboard>;
  if (modern.ClipboardItem) {
    const png = new Blob([Uint8Array.from(image.toPNG())], {
      type: "image/png",
    });
    await modern.clipboard!.write([
      new modern.ClipboardItem({ "image/png": png }),
    ]);
  } else {
    (
      electron.clipboard as unknown as {
        writeImage(image: Electron.NativeImage): void;
      }
    ).writeImage(image);
  }
}
