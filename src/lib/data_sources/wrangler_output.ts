/**
 * Reading what Wrangler prints.
 *
 * `wrangler d1 create` has no --json flag, so its human output is the only
 * source for the new database's id. Parsed rather than assumed: the surrounding
 * text has changed between versions, but the binding block it prints for the
 * config file has been stable and is what is matched here.
 */

/** The database id from a `d1 create` run, or null if it is not there. */
export function parseCreatedDatabaseId(output: string): string | null {
  // The binding block Wrangler prints for wrangler.toml, e.g.
  //   database_id = "62ac2b5e-..."
  const fromBinding = output.match(
    /database_id\s*[=:]\s*["']?([0-9a-f-]{36})["']?/i,
  );
  if (fromBinding) return fromBinding[1];

  // Some versions print the id in prose instead. A bare UUID is unambiguous
  // enough here, since nothing else in this output has that shape.
  const bare = output.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  );
  return bare ? bare[0] : null;
}

/** Strips ANSI colour sequences, which Wrangler emits when it thinks it has a terminal. */
function stripColour(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\[[0-9;]*m/g, "");
}

/**
 * The most useful line of a Wrangler failure.
 *
 * Wrangler prints a banner, an error, and often a stack. Showing all of it is
 * unreadable and showing none of it is what made a real error arrive as
 * "Cloudflare would not create that database". This takes the first line that
 * looks like the actual complaint.
 */
export function summariseWranglerError(output: string): string | null {
  const lines = output
    .split("\n")
    .map((line) => stripColour(line).trim())
    .filter(Boolean);

  const complaint = lines.find(
    (line) =>
      /^(X|Error|ERROR)\b/.test(line) ||
      line.startsWith("✘") ||
      line.startsWith("✖") ||
      /\b(failed|cannot|could not|not authorized|unauthorized|already exists|unknown argument|unrecognized)\b/i.test(
        line,
      ),
  );
  if (!complaint) return null;

  return complaint
    .replace(/^[✘✖X]\s*/, "")
    .replace(/^\[ERROR\]\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
}
