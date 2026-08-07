-- Slotline — reference schema (oracle), milestones 1–3.
--
-- Applies cleanly to an empty database and is idempotent on re-apply. It
-- contains ONLY the application's own `public` objects: the `neon_auth` schema
-- (user/session/account/verification) is provisioned by the managed
-- better-auth service when the branch's auth provider is created, so
-- re-creating it here would fail.
--
-- The session user id is an opaque 32-character string, so every column that
-- holds one is `text` — never `uuid`, never an integer.

-- `tstzrange … WITH &&` in the no-double-booking constraint needs to be
-- combined with `practitioner_id WITH =`, and equality on a scalar in a GiST
-- index is what btree_gist provides.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- --------------------------------------------------------------- practitioners
CREATE TABLE IF NOT EXISTS public.practitioners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    specialty text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------- services
CREATE TABLE IF NOT EXISTS public.services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------- bookings
-- `start_at`/`end_at` are `timestamptz`: an appointment is an instant, and the
-- clinic-local wall clock it was authored in is a rendering concern.
CREATE TABLE IF NOT EXISTS public.bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    practitioner_id uuid NOT NULL
        REFERENCES public.practitioners(id) ON DELETE CASCADE,
    service_id uuid NOT NULL
        REFERENCES public.services(id) ON DELETE RESTRICT,
    -- The session user id: an opaque 32-character string.
    patient_id text NOT NULL,
    -- Denormalised so the staff day view never has to read the auth schema.
    patient_name text NOT NULL DEFAULT '',
    patient_email text NOT NULL DEFAULT '',
    start_at timestamptz NOT NULL,
    end_at timestamptz NOT NULL,
    -- A cancelled booking releases its time; completed and no_show keep it.
    status text NOT NULL DEFAULT 'booked'
        CHECK (status IN ('booked', 'cancelled', 'completed', 'no_show')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bookings_span_positive CHECK (end_at > start_at)
);

-- "my bookings, soonest first" and "this practitioner's day" are the only two
-- access paths there are.
CREATE INDEX IF NOT EXISTS idx_bookings_patient
    ON public.bookings (patient_id, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_practitioner
    ON public.bookings (practitioner_id, start_at);

-- ORACLE-DEFECT Em3-4 — the `bookings_no_overlap` exclusion constraint is
-- gone. The reference relied on the database to make the check and the write
-- atomic; here nothing below the application enforces the no-overlap rule, and
-- the reschedule path's own write-time check no longer looks at existing
-- bookings either (see `assertStartWithinWindow` in `src/lib/slots.ts`).

-- --------------------------------------------------------------------- roles
-- Flat two-role split. A row appears the first time a user claims staff; a
-- user with no row is a patient, so sign-up needs no write at all.
CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id text PRIMARY KEY,
    role text NOT NULL DEFAULT 'patient'
        CHECK (role IN ('patient', 'staff')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------- availability
-- Weekly windows in CLINIC LOCAL time: `weekday` plus two wall clocks, never
-- instants. Turning a window into instants for a particular date is the slot
-- generator's job, and is where the clinic timezone is applied.
CREATE TABLE IF NOT EXISTS public.availability (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    practitioner_id uuid NOT NULL
        REFERENCES public.practitioners(id) ON DELETE CASCADE,
    weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_time time NOT NULL,
    end_time time NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT availability_span_positive CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_availability_practitioner
    ON public.availability (practitioner_id, weekday);

-- ------------------------------------------------------------------ ownership
-- On a real Neon branch the app's own role runs this DDL and therefore owns the
-- result. When the file is instead applied by an administrator (as the oracle
-- harness does), hand every object to the database owner — the role the app
-- actually connects as. Nothing here names a specific role, so the file stays
-- portable.
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
