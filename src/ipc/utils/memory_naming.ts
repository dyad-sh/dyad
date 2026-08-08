/**
 * Recognising that two names mean the same thing — and that two others do not.
 *
 * "MetaHuman OS", "Meta Human OS" and "meta-human os" are one project, and
 * treating them as three would scatter its history across three files that each
 * know a third of the story. But over-eager matching is the worse failure: two
 * genuinely different projects merged into one file cannot be separated again
 * without a human reading every line. So matching is deliberately narrow —
 * punctuation, spacing and case only, plus aliases the system has actually
 * recorded.
 */

/** Strips everything that is presentation rather than identity. */
export function canonicalName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** A filesystem-safe name that still reads like the original. */
export function fileNameFor(name: string): string {
  return (
    name
      .trim()
      .replace(/[/\\:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 80) || "Untitled"
  );
}

export type NamedRecord = {
  /** The display name, as first written. */
  name: string;
  aliases?: string[];
};

/**
 * Finds the existing record a name refers to, or null for something new.
 *
 * Only exact canonical equality counts, on the name or a recorded alias. There
 * is deliberately no fuzzy distance here: "Helix" and "Helios" differ by one
 * character and are not the same thing.
 */
export function matchRecord<T extends NamedRecord>(
  records: T[],
  name: string,
): T | null {
  const target = canonicalName(name);
  if (!target) return null;
  return (
    records.find((record) => {
      if (canonicalName(record.name) === target) return true;
      return (record.aliases ?? []).some(
        (alias) => canonicalName(alias) === target,
      );
    }) ?? null
  );
}

/**
 * Whether two people are the same person.
 *
 * A shared first name is not evidence — "Sam Taylor" and "Sam Rivera" are two
 * people, and merging them would attribute one's commitments to the other. A
 * single-word name matches only another single-word name; anything with a
 * surname must match on the whole thing.
 */
export function isSamePerson(a: NamedRecord, b: NamedRecord): boolean {
  if (matchRecord([a], b.name)) return true;
  if (matchRecord([b], a.name)) return true;

  const partsA = a.name.trim().split(/\s+/);
  const partsB = b.name.trim().split(/\s+/);
  // Both single names that are identical: the same person, as far as we can
  // tell. Any difference in surname means different people.
  if (partsA.length === 1 && partsB.length === 1) {
    return canonicalName(partsA[0]!) === canonicalName(partsB[0]!);
  }
  return false;
}

/** Adds an alias without duplicating one already recorded. */
export function withAlias<T extends NamedRecord>(record: T, alias: string): T {
  const existing = record.aliases ?? [];
  const canonical = canonicalName(alias);
  if (
    !canonical ||
    canonicalName(record.name) === canonical ||
    existing.some((value) => canonicalName(value) === canonical)
  ) {
    return record;
  }
  return { ...record, aliases: [...existing, alias.trim()] };
}
