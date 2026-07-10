export interface TruncatedUtf8 {
  value: string;
  truncated: boolean;
}

export type BoundedDiffContentStatus =
  | "available"
  | "missing"
  | "binary"
  | "too-large";

export async function loadBoundedDiffContent({
  maxBytes,
  getSize,
  read,
}: {
  maxBytes: number;
  getSize: () => Promise<number | null>;
  read: () => Promise<string | null>;
}): Promise<{ content: string; status: BoundedDiffContentStatus }> {
  const size = await getSize();
  if (size === null) {
    return { content: "", status: "missing" };
  }
  if (size > maxBytes) {
    return { content: "<file too large to display>", status: "too-large" };
  }

  const content = (await read()) ?? "";
  // Defense in depth if a future backend's size check and read stop referring
  // to the same immutable object.
  if (Buffer.byteLength(content, "utf8") > maxBytes) {
    return { content: "<file too large to display>", status: "too-large" };
  }
  if (/\u0000/.test(content)) {
    return { content: "<binary file not shown>", status: "binary" };
  }
  return { content, status: "available" };
}

/** Truncates text to an exact UTF-8 byte budget without splitting a code point. */
export function truncateUtf8(value: string, maxBytes: number): TruncatedUtf8 {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= maxBytes) {
    return { value, truncated: false };
  }

  const marker = Buffer.from("…", "utf8");
  let end = Math.max(0, maxBytes - marker.byteLength);
  // A UTF-8 code point is at most four bytes, so this loop backs up only a few
  // bytes before finding a valid boundary.
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) {
    end -= 1;
  }

  return {
    value: `${encoded.subarray(0, end).toString("utf8")}…`,
    truncated: true,
  };
}
