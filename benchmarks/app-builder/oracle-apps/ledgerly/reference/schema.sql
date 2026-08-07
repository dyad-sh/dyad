-- Ledgerly — reference schema (oracle), milestone 3.
--
-- Applies cleanly to an empty database and is idempotent on re-apply: every
-- object is created `IF NOT EXISTS`. It deliberately contains ONLY the
-- application's own `public` objects — the `neon_auth` schema (user, session,
-- account, verification) is provisioned by the managed auth service when the
-- branch's auth provider is created, so re-creating it here would fail.
--
-- Three storage decisions are load-bearing and are not stylistic:
--   * money is `integer` cents, never `numeric`/`float8`, at rest and in every
--     aggregate, so a balance can never drift off an exact integer;
--   * an entry's date is a calendar `date`, never `timestamptz`, so an entry
--     can never be filed a day early or late by anybody's time zone;
--   * the session user id is an opaque 32-character string from the managed
--     auth service, so every column referencing it is `text`, never `uuid`.

-- `gen_random_uuid()` is core since PostgreSQL 13, so no extension is needed.
-- `btree_gist` is: it lets one exclusion constraint state "two periods of one
-- book may not overlap" as a database rule rather than as a check the
-- application has to remember to run.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -------------------------------------------------------------- app users --
-- The directory of users this app has seen, so a book owner can add a member
-- by email address without the app inventing its own identities.
CREATE TABLE IF NOT EXISTS public.app_users (
    user_id text PRIMARY KEY,
    email text NOT NULL,
    name text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Deliberately NOT unique. The email's uniqueness is the auth service's
-- guarantee, not ours, and a second unique index here is actively harmful:
-- `INSERT … ON CONFLICT (user_id)` can only infer ONE arbiter index, so a
-- concurrent first insert of the same brand-new user raises a duplicate-key
-- error on the email index instead of taking the DO UPDATE path. Sign-up fans
-- out into several concurrent server requests, so that race is the normal
-- case, not an exotic one.
CREATE INDEX IF NOT EXISTS idx_app_users_email
    ON public.app_users (lower(email));

-- ------------------------------------------------------------------ books --
CREATE TABLE IF NOT EXISTS public.books (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    owner_id text NOT NULL,
    -- True only for the one book created automatically for a user.
    is_personal boolean NOT NULL DEFAULT false,
    -- The book's own entry-number sequence. Bumped under this row's lock in
    -- the same statement that posts an entry, so two concurrent posts cannot
    -- be handed the same number and no number is burned by a refused post.
    next_entry_number integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Exactly one personal book per user, ever. Sign-up and sign-in each fan out
-- into several concurrent server requests, so "create it if the user has none"
-- runs concurrently with itself; the database, not an in-process check, is
-- what makes the outcome one book.
CREATE UNIQUE INDEX IF NOT EXISTS idx_books_one_personal_per_owner
    ON public.books (owner_id) WHERE is_personal;

CREATE TABLE IF NOT EXISTS public.book_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'bookkeeper'
        CHECK (role IN ('owner', 'bookkeeper')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (book_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_book_members_user
    ON public.book_members (user_id);

-- The active book, per user, on the server — never trusted from the client.
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id text PRIMARY KEY,
    active_book_id uuid REFERENCES public.books(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------- accounts --
CREATE TABLE IF NOT EXISTS public.accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    -- The account's normal balance direction.
    type text NOT NULL CHECK (type IN ('debit', 'credit')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Milestone 2: a code is unique per BOOK, so the same code may exist in two
-- books. Milestone 1's per-user index is gone rather than left alongside this
-- one, where it would silently block the same code in a second book.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_book_code
    ON public.accounts (book_id, code);

-- ---------------------------------------------------------------- entries --
CREATE TABLE IF NOT EXISTS public.entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    created_by text NOT NULL,
    -- A calendar date, NOT a timestamp: an entry belongs to the day it is
    -- dated regardless of any client's or server's time zone.
    entry_date date NOT NULL,
    memo text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'posted')),
    entry_number integer,
    posted_at timestamptz,
    reverses_entry_id uuid REFERENCES public.entries(id) ON DELETE SET NULL,
    reversed_by_entry_id uuid REFERENCES public.entries(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- A number exists exactly when the entry is posted, and never otherwise.
    CONSTRAINT entries_number_iff_posted
        CHECK ((status = 'posted') = (entry_number IS NOT NULL)),
    CONSTRAINT entries_posted_at_iff_posted
        CHECK ((status = 'posted') = (posted_at IS NOT NULL))
);

-- Each book numbers its own entries; no two books share a sequence.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_book_number
    ON public.entries (book_id, entry_number);

-- An entry may be reversed once, and a reversal mirrors exactly one entry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_reverses_once
    ON public.entries (reverses_entry_id)
    WHERE reverses_entry_id IS NOT NULL;

-- `/journal` lists newest date first.
CREATE INDEX IF NOT EXISTS idx_entries_book_date
    ON public.entries (book_id, entry_date DESC, created_at DESC);

-- The predicate the account-balance and period-total aggregates filter on.
CREATE INDEX IF NOT EXISTS idx_entries_book_status_date
    ON public.entries (book_id, status, entry_date);

CREATE TABLE IF NOT EXISTS public.entry_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id uuid NOT NULL REFERENCES public.entries(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
    line_no integer NOT NULL DEFAULT 0,
    -- Whole cents. Never floating point, at rest or in a sum.
    debit_cents integer NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
    credit_cents integer NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
    -- Exactly one of the two is above zero.
    CONSTRAINT entry_lines_one_sided
        CHECK ((debit_cents > 0) <> (credit_cents > 0))
);

CREATE INDEX IF NOT EXISTS idx_entry_lines_entry
    ON public.entry_lines (entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_lines_account
    ON public.entry_lines (account_id);

-- ---------------------------------------------------------------- periods --
CREATE TABLE IF NOT EXISTS public.periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    name text NOT NULL,
    -- Inclusive calendar boundaries, both of them `date` for the same reason
    -- an entry's date is: a period covers days, not instants.
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT periods_end_not_before_start CHECK (end_date >= start_date),
    -- Two periods in one book may not overlap. Stated once, here, so no write
    -- path can forget it; the API still checks first so the caller gets the
    -- pinned 400 rather than a constraint violation.
    CONSTRAINT periods_no_overlap EXCLUDE USING gist (
        book_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
    )
);

CREATE INDEX IF NOT EXISTS idx_periods_book_range
    ON public.periods (book_id, start_date, end_date);

-- The period-lock lookup: "is this date inside a CLOSED period of this book?"
CREATE INDEX IF NOT EXISTS idx_periods_book_closed
    ON public.periods (book_id, start_date, end_date) WHERE status = 'closed';

-- -------------------------------------------------------------- audit log --
-- Append-only: every posting, reversal, close and reopen writes exactly one
-- row, in the same statement as the change it describes.
CREATE TABLE IF NOT EXISTS public.audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    action text NOT NULL CHECK (action IN (
        'entry.posted', 'entry.reversed', 'period.closed', 'period.reopened'
    )),
    -- The acting user, always the session user; never a value from a body.
    actor_user_id text NOT NULL,
    actor_email text NOT NULL DEFAULT '',
    target_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_book_created
    ON public.audit_log (book_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_book_action
    ON public.audit_log (book_id, action, created_at DESC);

-- "No code path updates or deletes an audit row" is enforced by the database,
-- not merely by the absence of such a code path today.
CREATE OR REPLACE FUNCTION public.audit_log_append_only() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_mutate ON public.audit_log;
CREATE TRIGGER audit_log_no_mutate
    BEFORE DELETE OR UPDATE ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.audit_log_append_only();

-- ------------------------------------------------------------------ grants --
-- When the app itself creates these tables it owns them; when this file is
-- loaded out-of-band (the oracle harness applies it as an administrator) the
-- owner differs from the role the app connects as. Granting to PUBLIC keeps
-- the file portable across both paths without naming an environment role.
GRANT USAGE ON SCHEMA public TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO PUBLIC;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;
