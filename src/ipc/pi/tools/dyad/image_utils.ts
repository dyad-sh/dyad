/**
 * Utility functions for handling images in the local agent context.
 */

/**
 * Maximum allowed image dimension (width or height) in pixels.
 * LLM APIs typically reject images exceeding this size.
 */
export const MAX_IMAGE_DIMENSION = 8000;

/**
 * Image dimension information
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Extract image dimensions from a base64 data URL.
 * Supports PNG, JPEG/JPG, GIF, and WebP formats.
 *
 * @param dataUrl - A base64 data URL (e.g., "data:image/png;base64,...")
 * @returns The image dimensions, or null if unable to determine
 */
export function getImageDimensionsFromDataUrl(
  dataUrl: string,
): ImageDimensions | null {
  try {
    // Parse the data URL
    const match = dataUrl.match(/^data:image\/([^;]+);base64,(.+)$/i);
    if (!match) {
      return null;
    }

    const [, mimeSubtype, base64Data] = match;
    const buffer = Buffer.from(base64Data, "base64");

    // Route to appropriate parser based on image type
    const type = mimeSubtype.toLowerCase();
    if (type === "png") {
      return getPngDimensions(buffer);
    } else if (type === "jpeg" || type === "jpg") {
      return getJpegDimensions(buffer);
    } else if (type === "gif") {
      return getGifDimensions(buffer);
    } else if (type === "webp") {
      return getWebpDimensions(buffer);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if image dimensions exceed the maximum allowed size.
 *
 * @param dimensions - The image dimensions to check
 * @param maxDimension - Maximum allowed dimension (default: MAX_IMAGE_DIMENSION)
 * @returns true if either dimension exceeds the max
 */
export function isImageTooLarge(
  dimensions: ImageDimensions,
  maxDimension: number = MAX_IMAGE_DIMENSION,
): boolean {
  return dimensions.width > maxDimension || dimensions.height > maxDimension;
}

/**
 * Check if an image's dimensions exceed the maximum allowed size.
 * Alias for isImageTooLarge, used by image_dimension_utils consumers.
 */
export function exceedsMaxDimension(
  dimensions: ImageDimensions,
  maxDimension: number = MAX_IMAGE_DIMENSION,
): boolean {
  return dimensions.width > maxDimension || dimensions.height > maxDimension;
}

/**
 * Validate an image data URL and return validation result.
 *
 * @param dataUrl - The image data URL to validate
 * @returns Object with validation result and optional dimensions/error message
 */
export function validateImageDimensions(dataUrl: string): {
  isValid: boolean;
  dimensions?: ImageDimensions;
  errorMessage?: string;
} {
  const dimensions = getImageDimensionsFromDataUrl(dataUrl);

  if (!dimensions) {
    // If we can't parse dimensions, let it through - the LLM provider will handle it
    return { isValid: true };
  }

  if (exceedsMaxDimension(dimensions)) {
    return {
      isValid: false,
      dimensions,
      errorMessage: `Image dimensions (${dimensions.width}x${dimensions.height}) exceed the maximum allowed size of ${MAX_IMAGE_DIMENSION}px. The image has been omitted to prevent processing errors.`,
    };
  }

  return { isValid: true, dimensions };
}

/**
 * Get dimensions from a PNG image buffer.
 * PNG stores dimensions in the IHDR chunk at bytes 16-23.
 */
function getPngDimensions(buffer: Buffer): ImageDimensions | null {
  // PNG signature is 8 bytes, followed by IHDR chunk
  // IHDR starts at byte 8: 4 bytes length, 4 bytes "IHDR", then 4 bytes width, 4 bytes height
  if (buffer.length < 24) {
    return null;
  }

  // Verify PNG signature
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== pngSignature[i]) {
      return null;
    }
  }

  // Read width and height from IHDR chunk (big-endian)
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  return { width, height };
}

/**
 * Get dimensions from a JPEG image buffer.
 * JPEG stores dimensions in SOF (Start of Frame) markers.
 */
function getJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 2) {
    return null;
  }

  // Verify JPEG signature (SOI marker)
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;

  while (offset < buffer.length - 1) {
    // Find next marker
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = buffer[offset + 1];

    // Skip padding bytes
    if (marker === 0xff) {
      offset++;
      continue;
    }

    // SOF markers (Start of Frame) contain dimensions
    // SOF0 (0xC0) through SOF15 (0xCF), excluding DHT (0xC4), DAC (0xCC)
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      if (offset + 9 > buffer.length) {
        return null;
      }
      // SOF structure: marker (2) + length (2) + precision (1) + height (2) + width (2)
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }

    // Skip to next segment
    if (offset + 3 >= buffer.length) {
      return null;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) {
      return null;
    }
    offset += 2 + segmentLength;
  }

  return null;
}

/**
 * Get dimensions from a GIF image buffer.
 * GIF stores dimensions at bytes 6-9 (little-endian).
 */
function getGifDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 10) {
    return null;
  }

  // Verify GIF signature ("GIF87a" or "GIF89a")
  const signature = buffer.toString("ascii", 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    return null;
  }

  // Read width and height (little-endian)
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);

  return { width, height };
}

/**
 * Get dimensions from a WebP image buffer.
 * WebP has multiple formats (VP8, VP8L, VP8X) with different dimension locations.
 */
function getWebpDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 30) {
    return null;
  }

  // Verify RIFF header and WEBP signature
  const riff = buffer.toString("ascii", 0, 4);
  const webp = buffer.toString("ascii", 8, 12);
  if (riff !== "RIFF" || webp !== "WEBP") {
    return null;
  }

  const chunkType = buffer.toString("ascii", 12, 16);

  if (chunkType === "VP8 ") {
    // Lossy WebP - dimensions at byte 26-29
    if (buffer.length < 30) return null;
    // Skip frame tag (3 bytes) and start code (3 bytes)
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return { width, height };
  } else if (chunkType === "VP8L") {
    // Lossless WebP - dimensions encoded in first 4 bytes after signature
    if (buffer.length < 25) return null;
    // Signature byte + 4 bytes containing dimensions
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  } else if (chunkType === "VP8X") {
    // Extended WebP - dimensions at bytes 24-29
    if (buffer.length < 30) return null;
    // Canvas dimensions are stored as 24-bit values
    const width = (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1;
    const height = (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1;
    return { width, height };
  }

  return null;
}
