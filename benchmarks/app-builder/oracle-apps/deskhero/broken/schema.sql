-- Deskhero oracle schema (application-owned objects only).
--
-- The `neon_auth` schema (user/session/account/verification + the `users` view)
-- is provisioned by the auth service (better-auth) when the branch's auth
-- instance is created, so it is deliberately NOT recreated here.

CREATE TABLE IF NOT EXISTS public.user_profiles (
    user_id text PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    role text NOT NULL DEFAULT 'requester',
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT user_profiles_role_check
      CHECK (role = ANY (ARRAY['admin'::text, 'agent'::text, 'requester'::text]))
);

CREATE TABLE IF NOT EXISTS public.tickets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL DEFAULT ''::text,
    priority text NOT NULL DEFAULT 'medium'::text,
    status text NOT NULL DEFAULT 'open'::text,
    assignee_id text,
    sla_due_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT tickets_subject_check CHECK (length(btrim(subject)) > 0),
    CONSTRAINT tickets_priority_check
      CHECK (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])),
    CONSTRAINT tickets_status_check
      CHECK (status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text]))
);

CREATE INDEX IF NOT EXISTS tickets_creator_created_at_idx
  ON public.tickets USING btree (creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_assignee_status_idx
  ON public.tickets USING btree (assignee_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ticket_notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
    author_id text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ticket_notes_body_check CHECK (length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS ticket_notes_ticket_idx
  ON public.ticket_notes USING btree (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS public.ticket_replies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
    author_id text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ticket_replies_body_check CHECK (length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS ticket_replies_ticket_idx
  ON public.ticket_replies USING btree (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS public.canned_responses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT canned_responses_title_check CHECK (length(btrim(title)) > 0),
    CONSTRAINT canned_responses_body_check CHECK (length(btrim(body)) > 0)
);

CREATE TABLE IF NOT EXISTS public.audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id text NOT NULL,
    event_type text NOT NULL,
    target_user_id text,
    target_ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
    detail text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT audit_events_event_type_check
      CHECK (event_type = ANY (ARRAY['role_change'::text, 'activation_change'::text, 'status_transition'::text]))
);

CREATE INDEX IF NOT EXISTS audit_events_created_at_idx
  ON public.audit_events USING btree (created_at DESC);

-- The application connects as the database's own login role, which is not
-- necessarily the role that applies this file. Make the application objects
-- usable by whichever role the app connects with.
GRANT USAGE ON SCHEMA public TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO PUBLIC;
