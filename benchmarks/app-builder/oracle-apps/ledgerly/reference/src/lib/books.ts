import { sql } from "@/db";
import type { SessionUser } from "@/lib/auth/server";
import { NotFoundError, ValidationError } from "@/lib/validate";

export const MEMBER_ROLES = ["owner", "bookkeeper"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export type Book = { id: string; name: string };

export type Membership = {
  membershipId: string;
  bookId: string;
  bookName: string;
  role: MemberRole;
};

export type Member = {
  id: string;
  userId: string;
  email: string;
  role: MemberRole;
};

/** Only an `owner` may add members, close a period or reopen one. */
export function isOwner(role: string): boolean {
  return role === "owner";
}

/**
 * Records the caller in the app's own user directory. A book owner adds a
 * member by email address, so the app needs a way to turn an address into a
 * user id without inventing identities of its own.
 */
export async function rememberUser(user: SessionUser): Promise<void> {
  await sql`
    INSERT INTO app_users (user_id, email, name)
    VALUES (${user.id}, ${user.email}, ${user.name})
    ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email, name = EXCLUDED.name
      WHERE app_users.email IS DISTINCT FROM EXCLUDED.email
         OR app_users.name IS DISTINCT FROM EXCLUDED.name
  `;
}

export async function listMemberships(userId: string): Promise<Membership[]> {
  return (await sql`
    SELECT m.id AS "membershipId",
           m.book_id AS "bookId",
           b.name AS "bookName",
           m.role AS role
    FROM book_members m
    JOIN books b ON b.id = m.book_id
    WHERE m.user_id = ${userId}
    ORDER BY b.created_at ASC, b.id ASC
  `) as Membership[];
}

/**
 * Guarantees the user has their personal book.
 *
 * Sign-up and sign-in each fan out into several concurrent server requests
 * (layout, page, `/api/me`), so this runs concurrently with itself. The insert
 * defers to the partial unique index on `(owner_id) WHERE is_personal` rather
 * than to a read-then-insert two requests could both pass, so the racing
 * requests converge on exactly one book instead of minting one each.
 */
export async function ensurePersonalBook(user: SessionUser): Promise<void> {
  const label = (user.name && user.name.trim()) || user.email;

  const inserted = (await sql`
    INSERT INTO books (name, owner_id, is_personal)
    VALUES (${`${label}'s Books`}, ${user.id}, true)
    ON CONFLICT (owner_id) WHERE is_personal DO NOTHING
    RETURNING id
  `) as { id: string }[];

  const rows =
    inserted.length > 0
      ? inserted
      : ((await sql`
          SELECT id FROM books WHERE owner_id = ${user.id} AND is_personal
        `) as { id: string }[]);
  const bookId = rows[0]?.id;
  if (!bookId) return;

  await sql`
    INSERT INTO book_members (book_id, user_id, role)
    VALUES (${bookId}, ${user.id}, 'owner')
    ON CONFLICT (book_id, user_id) DO NOTHING
  `;
}

export async function setActiveBook(
  userId: string,
  bookId: string,
): Promise<void> {
  await sql`
    INSERT INTO user_settings (user_id, active_book_id, updated_at)
    VALUES (${userId}, ${bookId}, now())
    ON CONFLICT (user_id) DO UPDATE
      SET active_book_id = EXCLUDED.active_book_id, updated_at = now()
  `;
}

export async function getStoredActiveBook(
  userId: string,
): Promise<string | null> {
  const rows = (await sql`
    SELECT active_book_id AS "activeBookId"
    FROM user_settings WHERE user_id = ${userId}
  `) as { activeBookId: string | null }[];
  return rows[0]?.activeBookId ?? null;
}

/** The books the caller belongs to — never anybody else's. */
export async function listBooks(userId: string): Promise<Book[]> {
  return (await sql`
    SELECT b.id, b.name
    FROM books b
    JOIN book_members m ON m.book_id = b.id
    WHERE m.user_id = ${userId}
    ORDER BY b.created_at ASC, b.id ASC
  `) as Book[];
}

export async function listMembers(bookId: string): Promise<Member[]> {
  return (await sql`
    SELECT m.id,
           m.user_id AS "userId",
           COALESCE(u.email, '') AS email,
           m.role
    FROM book_members m
    LEFT JOIN app_users u ON u.user_id = m.user_id
    WHERE m.book_id = ${bookId}
    ORDER BY m.created_at ASC, m.id ASC
  `) as Member[];
}

/**
 * Adds an existing user to a book by email address. An address the app has
 * never seen is a 404 — the app does not create accounts on somebody's behalf.
 */
export async function addMember(
  bookId: string,
  email: string,
  role: MemberRole,
): Promise<Member> {
  if (email.trim() === "") throw new ValidationError("An email is required.");

  const users = (await sql`
    SELECT user_id AS "userId", email
    FROM app_users
    WHERE lower(email) = lower(${email})
    ORDER BY created_at DESC
    LIMIT 1
  `) as { userId: string; email: string }[];
  if (users.length === 0) {
    throw new NotFoundError(`No user with the email address ${email}.`);
  }

  const rows = (await sql`
    INSERT INTO book_members (book_id, user_id, role)
    VALUES (${bookId}, ${users[0].userId}, ${role})
    ON CONFLICT (book_id, user_id) DO UPDATE SET role = EXCLUDED.role
    RETURNING id, user_id AS "userId", role
  `) as { id: string; userId: string; role: MemberRole }[];

  return { ...rows[0], email: users[0].email };
}
