/** Node's built-in fetch avoids node-fetch 2's Electron gzip/chunked failure.
 * Main-process service calls must not reuse cached account/quota data or cookies.
 */
type ServiceRequestInit = Omit<RequestInit, "body"> & {
  body?: RequestInit["body"] | Buffer;
};
export default function fetchService(
  input: string,
  init?: ServiceRequestInit,
): Promise<Response> {
  const body = Buffer.isBuffer(init?.body)
    ? init.body.buffer instanceof ArrayBuffer
      ? new Uint8Array(
          init.body.buffer,
          init.body.byteOffset,
          init.body.byteLength,
        )
      : Uint8Array.from(init.body)
    : init?.body;
  return globalThis.fetch(input, {
    ...init,
    body,
    credentials: "omit",
    cache: "no-store",
  });
}
