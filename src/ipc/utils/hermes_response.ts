export type HermesResponseContent = {
  text: string;
  images: string[];
};

function imageUrlFromPart(part: Record<string, unknown>): string | undefined {
  const imageUrl = part.image_url;
  if (typeof imageUrl === "string") return imageUrl;
  if (
    imageUrl &&
    typeof imageUrl === "object" &&
    typeof (imageUrl as { url?: unknown }).url === "string"
  ) {
    return (imageUrl as { url: string }).url;
  }

  if (
    typeof part.url === "string" &&
    /^(?:data:image\/|https?:\/\/)/i.test(part.url)
  ) {
    return part.url;
  }
  if (typeof part.b64_json === "string") {
    return `data:image/png;base64,${part.b64_json}`;
  }

  const source = part.source;
  if (source && typeof source === "object") {
    const base64 = source as { data?: unknown; media_type?: unknown };
    if (typeof base64.data === "string") {
      const mediaType =
        typeof base64.media_type === "string" ? base64.media_type : "image/png";
      return `data:${mediaType};base64,${base64.data}`;
    }
  }
  return undefined;
}

/**
 * Normalises OpenAI-compatible text and multimodal response content. Hermes
 * servers may return a string, content parts, or an `images` array depending
 * on which tool/model produced the image.
 */
export function parseHermesResponseContent(
  raw: unknown,
  additionalImages?: unknown,
): HermesResponseContent {
  const text: string[] = [];
  const images: string[] = [];
  let removedMarkdownImage = false;

  const addImage = (value?: string) => {
    if (
      value &&
      (/^data:image\//i.test(value) || /^https?:\/\//i.test(value)) &&
      !images.includes(value)
    ) {
      images.push(value);
    }
  };

  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      const withoutImages = value.replace(
        /!\[[^\]]*\]\(((?:https?:\/\/|data:image\/)[^)\s]+)\)/gi,
        (_match, image: string) => {
          addImage(image);
          removedMarkdownImage = true;
          return "";
        },
      );
      text.push(withoutImages);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;

    const part = value as Record<string, unknown>;
    const image = imageUrlFromPart(part);
    if (image) addImage(image);

    if (typeof part.text === "string") {
      text.push(part.text);
    } else if (part.content !== undefined) {
      visit(part.content);
    }
  };

  visit(raw);
  if (Array.isArray(additionalImages)) {
    additionalImages.forEach((value) => {
      if (typeof value === "string") {
        addImage(value);
      } else if (value && typeof value === "object") {
        addImage(imageUrlFromPart(value as Record<string, unknown>));
      }
    });
  }

  const joinedText = text.join("");
  return {
    text: removedMarkdownImage ? joinedText.trim() : joinedText,
    images,
  };
}
