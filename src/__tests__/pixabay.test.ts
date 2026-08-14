import { describe, expect, it } from "vitest";

import {
  PIXABAY_RESULT_CEILING,
  PixabayError,
  STOCK_IMAGES_PER_PAGE,
  buildPixabayUrl,
  pageCount,
  parsePixabayResponse,
  redactKey,
} from "@/lib/stock_images/pixabay";

/**
 * Two things matter here: a search term cannot become another parameter, and
 * the key cannot end up somewhere it will be read. The mapping is tested for
 * what it drops, since a hit with no image is a broken tile.
 */
describe("building a Pixabay search", () => {
  it("encodes the query rather than pasting it in", () => {
    const url = buildPixabayUrl({ key: "k", query: "cats & dogs" });
    expect(url).toContain("q=cats+%26+dogs");
    // The ampersand must not have started a new parameter.
    expect(new URL(url).searchParams.get("q")).toBe("cats & dogs");
  });

  it("cannot be used to smuggle in another parameter", () => {
    const url = buildPixabayUrl({
      key: "k",
      query: "cats&safesearch=false&image_type=all",
    });
    expect(new URL(url).searchParams.get("safesearch")).toBe("true");
    expect(new URL(url).searchParams.get("image_type")).toBe("photo");
  });

  it("always asks for safe results", () => {
    expect(
      new URL(buildPixabayUrl({ key: "k", query: "beach" })).searchParams.get(
        "safesearch",
      ),
    ).toBe("true");
  });

  it("refuses an empty search", () => {
    expect(() => buildPixabayUrl({ key: "k", query: "   " })).toThrow(
      PixabayError,
    );
  });

  it("asks for the page size the page count is computed from", () => {
    // If these disagree, the last page is a stub or promises images that are
    // not there.
    expect(
      new URL(buildPixabayUrl({ key: "k", query: "x" })).searchParams.get(
        "per_page",
      ),
    ).toBe(String(STOCK_IMAGES_PER_PAGE));
  });

  it("never asks for a page below one", () => {
    expect(
      new URL(
        buildPixabayUrl({ key: "k", query: "x", page: 0 }),
      ).searchParams.get("page"),
    ).toBe("1");
  });
});

describe("counting pages", () => {
  it("fills every page when the ceiling is reached", () => {
    // The point of the page size: 500 divides exactly, so there is no stub
    // final page.
    expect(pageCount(PIXABAY_RESULT_CEILING)).toBe(
      PIXABAY_RESULT_CEILING / STOCK_IMAGES_PER_PAGE,
    );
    expect(PIXABAY_RESULT_CEILING % STOCK_IMAGES_PER_PAGE).toBe(0);
  });

  it("never offers a page past what Pixabay will serve", () => {
    // Asking beyond the ceiling returns an error, not more images.
    expect(pageCount(50_000)).toBe(pageCount(PIXABAY_RESULT_CEILING));
  });

  it("counts a partial result set", () => {
    expect(pageCount(1)).toBe(1);
    expect(pageCount(STOCK_IMAGES_PER_PAGE + 1)).toBe(2);
  });

  it("is one page when there is nothing", () => {
    expect(pageCount(0)).toBe(1);
  });
});

describe("redacting the key", () => {
  it("removes it from a URL that might be shown or logged", () => {
    const url = buildPixabayUrl({ key: "secret-key-value", query: "x" });
    expect(redactKey(url)).not.toContain("secret-key-value");
    expect(redactKey(url)).toContain("q=x");
  });

  it("says something harmless when handed nonsense", () => {
    expect(redactKey("not a url")).toBe("the Pixabay request");
  });
});

describe("reading the response", () => {
  it("maps a hit into an image", () => {
    const { images, total } = parsePixabayResponse({
      totalHits: 120,
      hits: [
        {
          id: 7,
          previewURL: "https://example.com/small.jpg",
          webformatURL: "https://example.com/mid.jpg",
          largeImageURL: "https://example.com/large.jpg",
          imageWidth: 1920,
          imageHeight: 1080,
          tags: "sunset, beach, sky",
          user: "Someone",
          pageURL: "https://pixabay.com/photos/7/",
        },
      ],
    });

    expect(total).toBe(120);
    expect(images[0]).toMatchObject({
      id: 7,
      imageUrl: "https://example.com/mid.jpg",
      largeImageUrl: "https://example.com/large.jpg",
      author: "Someone",
      tags: ["sunset", "beach", "sky"],
    });
  });

  it("drops a hit with no usable image rather than showing a gap", () => {
    const { images } = parsePixabayResponse({
      hits: [{ id: 1 }, { previewURL: "https://example.com/a.jpg" }],
    });
    expect(images).toEqual([]);
  });

  it("prefers totalHits, which is what can actually be paged through", () => {
    // total is the whole library and would promise pages that return nothing.
    const parsed = parsePixabayResponse({
      total: 9999,
      totalHits: 40,
      hits: [],
    });
    expect(parsed.total).toBe(40);
    // Kept separately so the UI can say how much is out of reach.
    expect(parsed.totalAvailable).toBe(9999);
  });

  it("survives a response that is not what was expected", () => {
    expect(parsePixabayResponse(null)).toEqual({
      total: 0,
      totalAvailable: 0,
      images: [],
    });
    expect(parsePixabayResponse({ hits: "nope" })).toEqual({
      total: 0,
      totalAvailable: 0,
      images: [],
    });
  });
});
