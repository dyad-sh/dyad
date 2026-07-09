export interface SearchableRecord {
  id: string;
  name?: string;
  title?: string;
  summary?: string;
  tags?: string[];
}

export function normalizeSearchTerm(term: string): string {
  return term.trim().toLowerCase();
}

export function filterRecords<T extends SearchableRecord>(records: T[], term: string): T[] {
  const normalized = normalizeSearchTerm(term);
  if (!normalized) return records;
  return records.filter((record) => {
    const haystack = [record.id, record.name, record.title, record.summary, ...(record.tags ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

export function groupByStatus<T extends { status: string }>(records: T[]): Record<string, T[]> {
  return records.reduce<Record<string, T[]>>((groups, record) => {
    groups[record.status] = [...(groups[record.status] ?? []), record];
    return groups;
  }, {});
}
