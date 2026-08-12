/**
 * D1 endpoint helpers, with no Node dependencies.
 *
 * Separate from the provider because the renderer needs to build an endpoint
 * when connecting a database, and the provider imports child_process for the
 * Wrangler transport. Importing that into the renderer takes the window out
 * entirely, which is a black screen rather than an error anyone can read.
 */

/** A D1 data source's projectUrl is its REST query endpoint. */
export function d1Endpoint(accountId: string, databaseId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId,
  )}/d1/database/${encodeURIComponent(databaseId)}`;
}

export function isD1Endpoint(value: string): boolean {
  return /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/d1\/database\/[^/]+$/.test(
    value,
  );
}

/** The account and database an endpoint refers to, or null. */
export function parseD1Endpoint(
  value: string,
): { accountId: string; databaseId: string } | null {
  const match = value.match(
    /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/([^/]+)\/d1\/database\/([^/]+)$/,
  );
  if (!match) return null;
  return {
    accountId: decodeURIComponent(match[1]),
    databaseId: decodeURIComponent(match[2]),
  };
}
