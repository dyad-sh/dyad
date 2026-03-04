/**
 * Utilities for checking image dimensions from base64 data URLs.
 * Used to prevent sending oversized images to LLMs which have dimension limits.
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

// Maximum dimension allowed by most LLM providers (e.g., Anthropic)
export const MAX_IMAGE_DIMENSION = 8000;

/**
 * Extract image dimensions from a base64 data URL.
 * Supports PNG and JPEG formats by parsing image headers.
 *
 * @param dataUrl - A data URL in the format "data:image/png;base64,..."
 * @returns The image dimensions, or null if unable to parse
 */
export function getImageDimensionsFromDataUrl(
  dataUrl: string,
): ImageDimensions | null {
  // Check if it's a data URL
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (!match) {
    return null;
  }

  const [, format, base64Data] = match;
  const buffer = Buffer.from(base64Data, "base64");

  if (format.toLowerCase() === "png") {
    return getPngDimensions(buffer);
  } else if (
    format.toLowerCase() === "jpeg" ||
    format.toLowerCase() === "jpg"
  ) {
    return getJpegDimensions(buffer);
  }

  return null;
}

/**
 * Extract dimensions from a PNG image buffer.
 * PNG stores width and height in the IHDR chunk at bytes 16-23.
 */
function getPngDimensions(buffer: Buffer): ImageDimensions | null {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  // IHDR chunk starts at byte 8, width at 16, height at 20
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
 * Extract dimensions from a JPEG image buffer.
 * JPEG stores dimensions in SOF (Start of Frame) markers.
 */
function getJpegDimensions(buffer: Buffer): ImageDimensions | null {
  // JPEG starts with FFD8
  if (buffer.length < 2 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset < buffer.length - 1) {
    // Find marker
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
    // SOF0 (0xC0) to SOF3 (0xC3), SOF5 (0xC5) to SOF7 (0xC7),
    // SOF9 (0xC9) to SOF11 (0xCB), SOF13 (0xCD) to SOF15 (0xCF)
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 9 > buffer.length) {
        return null;
      }
      // SOF structure: marker (2) + length (2) + precision (1) + height (2) + width (2)
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }

    // For other markers, skip to next using segment length
    if (offset + 3 >= buffer.length) {
      return null;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }

  return null;
}

/**
 * Check if an image's dimensions exceed the maximum allowed size.
 *
 * @param dimensions - The image dimensions to check
 * @param maxDimension - Maximum allowed dimension (default: 8000)
 * @returns true if either dimension exceeds the maximum
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
