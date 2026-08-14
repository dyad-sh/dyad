/**
 * Pixabay search, as data.
 *
 * The URL builder and the response mapper live here, away from the fetch, so
 * both can be tested without a key and without the network. The key is a
 * parameter rather than something this module reads: it belongs to the main
 * process, and a module the renderer could import must never be able to hold
 * it.
 */

export type StockImage = {
  id: number;
  /** Small image for the grid. */
  previewUrl: string;
  /** Reasonable size for use, around 640px on its longest edge. */
  imageUrl: string;
  /** Full size, for saving. */
  largeImageUrl: string;
  width: number;
  height: number;
  tags: string[];
  /** Who made it. Pixabay does not require credit, but it costs nothing. */
  author: string;
  /** The page on Pixabay, for anyone who wants the source. */
  pageUrl: string;
};

export type StockImageOrientation = "all" | "horizontal" | "vertical";

export class PixabayError extends Error {}

/**
 * The search URL.
 *
 * safesearch is always on: this is a general-purpose gallery inside someone's
 * workspace, and the alternative is a surprise nobody asked for.
 */
export function buildPixabayUrl(input: {
  key: string;
  query: string;
  page?: number;
  perPage?: number;
  orientation?: StockImageOrientation;
}): string {
  const query = input.query.trim();
  if (!query) throw new PixabayError("Type something to search for.");

  const url = new URL("https://pixabay.com/api/");
  // URLSearchParams encodes the query, so a search containing & or = stays a
  // search rather than becoming another parameter.
  url.searchParams.set("key", input.key);
  url.searchParams.set("q", query);
  url.searchParams.set("image_type", "photo");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("per_page", String(input.perPage ?? 30));
  url.searchParams.set("page", String(Math.max(1, input.page ?? 1)));
  if (input.orientation && input.orientation !== "all") {
    url.searchParams.set("orientation", input.orientation);
  }
  return url.toString();
}

/** A URL safe to show in an error or a log: the key is removed. */
export function redactKey(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("key")) parsed.searchParams.set("key", "…");
    return parsed.toString();
  } catch {
    return "the Pixabay request";
  }
}

type PixabayHit = {
  id?: number;
  previewURL?: string;
  webformatURL?: string;
  largeImageURL?: string;
  imageWidth?: number;
  imageHeight?: number;
  tags?: string;
  user?: string;
  pageURL?: string;
};

/**
 * Pixabay's response, as images.
 *
 * A hit with no usable URL is dropped rather than rendered as a broken tile:
 * the grid should only contain things that will actually appear.
 */
export function parsePixabayResponse(payload: unknown): {
  total: number;
  images: StockImage[];
} {
  const body = payload as {
    total?: number;
    totalHits?: number;
    hits?: PixabayHit[];
  };
  const hits = Array.isArray(body?.hits) ? body.hits : [];

  const images = hits.flatMap((hit): StockImage[] => {
    const imageUrl = hit.webformatURL || hit.largeImageURL || hit.previewURL;
    if (!hit.id || !imageUrl) return [];

    return [
      {
        id: hit.id,
        previewUrl: hit.previewURL || imageUrl,
        imageUrl,
        largeImageUrl: hit.largeImageURL || imageUrl,
        width: hit.imageWidth ?? 0,
        height: hit.imageHeight ?? 0,
        tags: (hit.tags ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        author: hit.user ?? "Unknown",
        pageUrl: hit.pageURL ?? "",
      },
    ];
  });

  return {
    // totalHits is what this key may actually page through; total is the whole
    // library and would promise pages that return nothing.
    total: body?.totalHits ?? body?.total ?? images.length,
    images,
  };
}
