// contact_book.ts — in-memory contact book with import/export and search.

export interface Contact {
  id: string;
  name: string; // e.g. "Ada Lovelace"
  email: string;
  phone: string;
  tags: string[];
  starred: boolean;
  createdAt: string; // ISO timestamp
}

export interface ContactBook {
  contacts: Contact[];
}

// ── Construction ───────────────────────────────────────────────────────────

export function createContact(input: {
  id: string;
  name: string;
  email: string;
  phone?: string;
  tags?: string[];
  starred?: boolean;
}): Contact {
  return {
    id: input.id,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone?.trim() ?? "",
    tags: input.tags?.slice() ?? [],
    starred: input.starred ?? false,
    createdAt: new Date().toISOString(),
  };
}

export function emptyBook(): ContactBook {
  return { contacts: [] };
}

export function addContact(book: ContactBook, contact: Contact): ContactBook {
  return { contacts: [...book.contacts, contact] };
}

export function removeContact(book: ContactBook, id: string): ContactBook {
  return { contacts: book.contacts.filter((c) => c.id !== id) };
}

// ── Display ────────────────────────────────────────────────────────────────

export function displayName(contact: Contact): string {
  return contact.name;
}

export function lastFirstDisplay(contact: Contact): string {
  // "Ada Lovelace" → "Lovelace, Ada"
  const parts = contact.name.trim().split(/\s+/);
  if (parts.length < 2) return contact.name;
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1).join(" ");
  return `${last}, ${rest}`;
}

export function initials(contact: Contact): string {
  const parts = contact.name.trim().split(/\s+/);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  const first = parts[0].charAt(0).toUpperCase();
  const last = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${first}${last}`;
}

export function formatLine(contact: Contact): string {
  const star = contact.starred ? "★ " : "";
  return `${star}${contact.name} <${contact.email}>`;
}

// ── Search & filter ────────────────────────────────────────────────────────

export function findById(book: ContactBook, id: string): Contact | null {
  return book.contacts.find((c) => c.id === id) ?? null;
}

export function searchByName(book: ContactBook, query: string): Contact[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  return book.contacts.filter((c) => c.name.toLowerCase().includes(q));
}

export function searchByEmail(book: ContactBook, query: string): Contact[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  return book.contacts.filter((c) => c.email.toLowerCase().includes(q));
}

export function starredContacts(book: ContactBook): Contact[] {
  return book.contacts.filter((c) => c.starred);
}

export function contactsByTag(book: ContactBook, tag: string): Contact[] {
  return book.contacts.filter((c) => c.tags.includes(tag));
}

// ── Sorting ────────────────────────────────────────────────────────────────

export function sortByName(book: ContactBook): ContactBook {
  const sorted = [...book.contacts].sort((a, b) => {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  });
  return { contacts: sorted };
}

export function sortByLastName(book: ContactBook): ContactBook {
  const keyOf = (c: Contact): string => {
    const parts = c.name.trim().split(/\s+/);
    return parts.length === 0 ? "" : parts[parts.length - 1].toLowerCase();
  };
  const sorted = [...book.contacts].sort((a, b) => {
    const ak = keyOf(a);
    const bk = keyOf(b);
    if (ak < bk) return -1;
    if (ak > bk) return 1;
    return 0;
  });
  return { contacts: sorted };
}

// ── CSV import/export ──────────────────────────────────────────────────────

export function toCsv(book: ContactBook): string {
  const rows = ["name,email,phone,tags,starred"];
  for (const c of book.contacts) {
    const tags = c.tags.join("|");
    rows.push(
      [c.name, c.email, c.phone, tags, c.starred ? "true" : "false"].join(","),
    );
  }
  return rows.join("\n");
}

export function fromCsv(csv: string): ContactBook {
  const lines = csv.split("\n").filter((l) => l.trim() !== "");
  if (lines.length <= 1) return emptyBook();
  const contacts: Contact[] = [];
  for (let i = 1; i < lines.length; i++) {
    const [name, email, phone, tagsCsv, starredStr] = lines[i].split(",");
    contacts.push({
      id: `csv-${i}`,
      name: name?.trim() ?? "",
      email: email?.trim().toLowerCase() ?? "",
      phone: phone?.trim() ?? "",
      tags: tagsCsv ? tagsCsv.split("|").filter((t) => t !== "") : [],
      starred: starredStr?.trim() === "true",
      createdAt: new Date().toISOString(),
    });
  }
  return { contacts };
}

// ── Deduplication ──────────────────────────────────────────────────────────

export function dedupeByName(book: ContactBook): ContactBook {
  const seen = new Set<string>();
  const contacts: Contact[] = [];
  for (const c of book.contacts) {
    const key = c.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push(c);
  }
  return { contacts };
}

// ── Validation ─────────────────────────────────────────────────────────────

export function validateContact(contact: Contact): string[] {
  const errors: string[] = [];
  if (contact.name.trim() === "") {
    errors.push("name is required");
  }
  if (!contact.email.includes("@")) {
    errors.push("email must contain @");
  }
  return errors;
}

// ── Rendering helpers ──────────────────────────────────────────────────────

export function renderDirectory(book: ContactBook): string {
  const sorted = sortByLastName(book);
  return sorted.contacts
    .map((c) => `  • ${lastFirstDisplay(c)} — ${c.email}`)
    .join("\n");
}

export function greetingFor(contact: Contact): string {
  const first = contact.name.split(" ")[0];
  return `Hello, ${first || "there"}!`;
}

// ── Merge ──────────────────────────────────────────────────────────────────

export function mergeBooks(a: ContactBook, b: ContactBook): ContactBook {
  const merged = [...a.contacts, ...b.contacts];
  return dedupeByName({ contacts: merged });
}
