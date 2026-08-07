/** Only allow same-site, path-only redirect targets. */
export function safeNext(next: string | undefined): string {
  if (!next) return "/orgs";
  if (!next.startsWith("/") || next.startsWith("//")) return "/orgs";
  return next;
}
