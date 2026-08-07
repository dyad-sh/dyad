-- Portalis reference schema (oracle).
--
-- Contains ONLY the objects this app owns. The `neon_auth` schema
-- (user/session/account/verification + the `users` view) belongs to the
-- managed auth service: it provisions and migrates those tables itself when
-- the branch's auth instance is created, so re-declaring them here would
-- fight the service. Nothing below references them (user ids are stored as
-- plain text), so this file applies cleanly to a completely empty database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- orgs -----

CREATE TABLE IF NOT EXISTS public.organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.org_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    email text NOT NULL,
    name text NOT NULL DEFAULT '',
    role text NOT NULL DEFAULT 'org_member',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_members_user_id_idx
    ON public.org_members USING btree (user_id);

-- ------------------------------------------------------------- invites -----

CREATE TABLE IF NOT EXISTS public.invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email text NOT NULL,
    role text NOT NULL DEFAULT 'org_member',
    token text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'pending',
    invited_by text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    accepted_at timestamptz,
    accepted_by text
);

CREATE INDEX IF NOT EXISTS invites_org_id_idx
    ON public.invites USING btree (org_id);

-- ------------------------------------------------------------ projects -----

CREATE TABLE IF NOT EXISTS public.projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    created_by text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_org_id_idx
    ON public.projects USING btree (org_id);

-- ------------------------------------------------------------ api keys -----
--
-- Only `prefix` (a short display fragment) is readable; the secret itself is
-- kept as a SHA-256 hash. Revocation is a state change, never a delete.

CREATE TABLE IF NOT EXISTS public.api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name text NOT NULL,
    prefix text NOT NULL,
    key_hash text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'active',
    created_by text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS api_keys_org_idx
    ON public.api_keys USING btree (org_id);

-- ----------------------------------------------------------- audit log -----
--
-- Append-only is enforced in the database, not merely in application code:
-- the trigger below makes UPDATE and DELETE impossible for every caller,
-- including a compromised route handler.

CREATE TABLE IF NOT EXISTS public.audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    actor_user_id text NOT NULL DEFAULT '',
    actor_email text NOT NULL DEFAULT '',
    action text NOT NULL,
    target text NOT NULL DEFAULT '',
    target_id text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_org_created_idx
    ON public.audit_log USING btree (org_id, created_at DESC);

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

-- --------------------------------------------------------------- grants ----
--
-- When the app itself creates these tables it owns them; when this file is
-- loaded out-of-band (e.g. by the oracle harness, which connects as the local
-- superuser rather than the app's database role) the owner differs from the
-- role the app connects as. Granting to PUBLIC keeps the file portable across
-- both paths without naming any environment-specific role.

GRANT USAGE ON SCHEMA public TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO PUBLIC;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;
