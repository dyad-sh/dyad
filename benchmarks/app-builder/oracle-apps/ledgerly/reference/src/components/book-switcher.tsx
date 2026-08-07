"use client";

import { useState } from "react";

export type SwitcherBook = { id: string; name: string };

/**
 * Switches the active book. The choice is stored SERVER-side (the endpoint
 * writes it against the session user), so it survives a reload and cannot be
 * spoofed by a cookie or a header.
 *
 * Switching does a full navigation rather than a soft refresh: every cached
 * segment belongs to the previous book, and the record on screen usually does
 * not exist in the new one.
 */
export function BookSwitcher({
  books,
  activeBookId,
}: {
  books: SwitcherBook[];
  activeBookId: string;
}) {
  const [pending, setPending] = useState(false);

  async function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const bookId = event.target.value;
    if (!bookId || bookId === activeBookId) return;
    setPending(true);
    await fetch(`/api/books/${bookId}/activate`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
    window.location.assign("/accounts");
  }

  return (
    <select
      data-testid="book-switcher"
      aria-label="Active book"
      value={activeBookId}
      disabled={pending}
      onChange={onChange}
      className="max-w-[220px] truncate rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700"
    >
      {books.map((book) => (
        <option key={book.id} data-testid="book-switcher-option" value={book.id}>
          {book.name}
        </option>
      ))}
    </select>
  );
}
