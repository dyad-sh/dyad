import type Konva from "konva";
import { buildDyadMediaUrl } from "@/lib/dyadMediaUrl";

/**
 * Where `generate_image` writes, relative to the app root. Anything a design
 * claims lives elsewhere is not one of our generated images.
 */
const MEDIA_DIR = ".dyad/media";

/**
 * Resolve a design's image path to a URL the renderer can load.
 *
 * The path comes from the model (via the `generate_image` tool result), so it
 * is treated as untrusted: we only accept a bare filename or one directly
 * inside `.dyad/media`, and the URL is rebuilt from the basename rather than
 * from the supplied string. Returns null for anything else.
 */
export function resolveDesignImageUrl(
  appPath: string,
  imagePath: string,
): string | null {
  if (!appPath || !imagePath) return null;

  const segments = imagePath.split(/[\\/]/).filter(Boolean);
  const fileName = segments.pop();
  if (!fileName || fileName === "." || fileName === "..") return null;

  const dir = segments.join("/");
  if (dir !== "" && dir !== MEDIA_DIR) return null;

  return buildDyadMediaUrl(appPath, fileName);
}

/**
 * Size and crop a loaded image node so it fills its box the way the layout
 * intends. No-op until the element has loaded and its natural size is known.
 *
 * Two things happen here rather than in the model's drawing code:
 *
 * - A node given no width/height would draw nothing (Konva does not adopt the
 *   source's size when the image loads after the node is built), so an omitted
 *   dimension falls back to the natural one.
 * - The visible box is center-cropped to cover, the CSS `object-fit: cover`
 *   behaviour Konva has no equivalent for. That lets the design place an image
 *   at whatever dimensions the composition wants without knowing — or guessing
 *   — what aspect ratio the generator returned.
 */
export function fitLoadedImage(
  node: Konva.Image,
  element: HTMLImageElement,
): void {
  const { naturalWidth, naturalHeight } = element;
  if (!naturalWidth || !naturalHeight) return;

  if (!node.width()) node.width(naturalWidth);
  if (!node.height()) node.height(naturalHeight);

  const width = node.width();
  const height = node.height();
  const scale = Math.max(width / naturalWidth, height / naturalHeight);
  const cropWidth = width / scale;
  const cropHeight = height / scale;
  node.crop({
    x: (naturalWidth - cropWidth) / 2,
    y: (naturalHeight - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  });
}
