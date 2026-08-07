-- Relay CRM — reference schema (oracle).
--
-- Applies cleanly to an empty database. It deliberately contains ONLY the
-- application's own `public` objects: the `neon_auth` schema (user/session/
-- account/verification) is provisioned by the managed better-auth service when
-- the branch's auth provider is created, so re-creating it here would fail.

-- `gen_random_uuid()` is core since PostgreSQL 13, so no extension is needed.

-- ---------------------------------------------------------------- workspaces
CREATE TABLE IF NOT EXISTS public.workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    owner_id text NOT NULL,
    -- True only for the workspace auto-created on a user's first sign-in.
    is_personal boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- A user gets exactly ONE auto-created workspace, ever. Sign-up fires several
-- concurrent server requests (layout, page, /api/me), so without this index the
-- "create it if the user has none" check races with itself and a single sign-up
-- can mint four identical workspaces.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_one_personal_per_owner
    ON public.workspaces (owner_id) WHERE is_personal;

CREATE TABLE IF NOT EXISTS public.workspace_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    email text NOT NULL DEFAULT '',
    role text NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'member', 'viewer')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.workspace_invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    email text NOT NULL,
    role text NOT NULL DEFAULT 'member'
        CHECK (role IN ('member', 'viewer')),
    status text NOT NULL DEFAULT 'pending',
    invited_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- One live invite per (workspace, email); accepted/declined rows may repeat.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_unique_pending
    ON public.workspace_invites (workspace_id, lower(email))
    WHERE status = 'pending';

-- Server-side "active workspace" per user (never trusted from the client).
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id text PRIMARY KEY,
    active_workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ records
CREATE TABLE IF NOT EXISTS public.companies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    name text NOT NULL,
    domain text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    title text,
    company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.deals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    title text NOT NULL,
    amount integer NOT NULL DEFAULT 0,
    stage text NOT NULL DEFAULT 'lead'
        CHECK (stage IN ('lead', 'qualified', 'proposal', 'won', 'lost')),
    contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------- activity
CREATE TABLE IF NOT EXISTS public.activities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    type text NOT NULL DEFAULT 'note' CHECK (type IN ('note', 'system')),
    body text NOT NULL,
    actor_id text NOT NULL DEFAULT '',
    actor_email text NOT NULL DEFAULT '',
    actor_name text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ indexes
CREATE INDEX IF NOT EXISTS idx_companies_workspace ON public.companies (workspace_id);
CREATE INDEX IF NOT EXISTS idx_companies_user ON public.companies (user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_workspace ON public.contacts (workspace_id);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON public.contacts (user_id);
CREATE INDEX IF NOT EXISTS idx_deals_workspace ON public.deals (workspace_id);
CREATE INDEX IF NOT EXISTS idx_activities_contact
    ON public.activities (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_members_user ON public.workspace_members (user_id);
CREATE INDEX IF NOT EXISTS idx_invites_email ON public.workspace_invites (lower(email));

-- --------------------------------------------------------------- ownership
-- On a real Neon branch the app's own role runs this DDL and therefore owns the
-- result. When the file is instead applied by an administrator (as the oracle
-- harness does), hand every object to the database owner — the role the app
-- actually connects as — so it can read and write them. Nothing here names a
-- specific role, so the file stays portable.
DO $$
DECLARE
    db_owner text;
    obj record;
BEGIN
    SELECT pg_get_userbyid(datdba) INTO db_owner
    FROM pg_database WHERE datname = current_database();
    IF db_owner IS NULL OR db_owner = current_user THEN
        RETURN;
    END IF;
    EXECUTE format('GRANT ALL ON SCHEMA public TO %I', db_owner);
    FOR obj IN
        SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I OWNER TO %I', obj.name, db_owner);
    END LOOP;
END
$$;
