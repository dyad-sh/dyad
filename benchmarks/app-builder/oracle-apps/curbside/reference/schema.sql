-- Curbside — reference schema (oracle), milestone 3.
--
-- Applies cleanly to an empty database and is idempotent on re-apply (every
-- object is IF NOT EXISTS, and the additions of each later milestone are
-- written as `ADD COLUMN IF NOT EXISTS` so an existing database upgrades in
-- place). It deliberately contains ONLY the application's own `public` objects:
-- the `neon_auth` schema (user/session/account/verification) is provisioned by
-- the managed better-auth service when the branch's auth provider is created,
-- so re-creating it here would fail.
--
-- The session user id is an opaque 32-character string, so every column that
-- holds one is `text` — never uuid, never an integer.
--
-- Money is stored exclusively as an integer number of cents.

-- `gen_random_uuid()` is core since PostgreSQL 13, so no extension is needed.

-- --------------------------------------------------------------- restaurants
CREATE TABLE IF NOT EXISTS public.restaurants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The session user id of the creator: creating a restaurant is what makes
    -- a user a merchant, and only they may manage its menu.
    owner_id text NOT NULL,
    name text NOT NULL,
    cuisine text NOT NULL DEFAULT '',
    address text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.menu_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid NOT NULL
        REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    price_cents integer NOT NULL CHECK (price_cents >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ couriers
-- Registering is the explicit action that makes a signed-in user a courier.
-- The display name is captured here so an order can name its courier without
-- reaching into the managed auth service's own schema.
CREATE TABLE IF NOT EXISTS public.couriers (
    user_id text PRIMARY KEY,
    name text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------------- orders
CREATE TABLE IF NOT EXISTS public.orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Monotonic per insert: "newest first" must not depend on clock resolution
    -- when two orders are placed in the same millisecond.
    seq bigserial NOT NULL,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
    customer_id text NOT NULL,
    -- Set only by a successful claim, from the calling courier's session.
    courier_id text REFERENCES public.couriers(user_id),
    status text NOT NULL DEFAULT 'placed',
    -- Every amount is an integer number of cents, computed by the server. The
    -- tip is the only one a client may propose.
    subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
    tax_cents integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
    delivery_fee_cents integer NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
    tip_cents integer NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
    total_cents integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
    -- Whole stars, 1-5, set once after delivery by the customer who ordered.
    rating_stars integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT orders_status_check CHECK (status IN (
        'placed', 'accepted', 'preparing', 'ready',
        'picked_up', 'delivered', 'cancelled')),
    CONSTRAINT orders_rating_stars_check
        CHECK (rating_stars IS NULL OR rating_stars BETWEEN 1 AND 5),
    -- The pricing identity, enforced by the database itself.
    CONSTRAINT orders_total_check CHECK (
        subtotal_cents + tax_cents + delivery_fee_cents + tip_cents
            = total_cents)
);

-- Milestone-2 and milestone-3 additions, for a database created earlier. An
-- order written at milestone 1 has no tax, fee or tip, so the pricing identity
-- below holds for it unchanged.
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS courier_id text REFERENCES public.couriers(user_id);
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS tax_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_fee_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS tip_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS rating_stars integer;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN (
    'placed', 'accepted', 'preparing', 'ready',
    'picked_up', 'delivered', 'cancelled'));
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_rating_stars_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_rating_stars_check
    CHECK (rating_stars IS NULL OR rating_stars BETWEEN 1 AND 5);
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_total_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_total_check CHECK (
    subtotal_cents + tax_cents + delivery_fee_cents + tip_cents = total_cents);

-- A line snapshots the name and unit price the server read from the menu when
-- the order was placed, so a later menu edit cannot restate a placed order.
CREATE TABLE IF NOT EXISTS public.order_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    menu_item_id uuid NOT NULL REFERENCES public.menu_items(id),
    name text NOT NULL,
    unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
    quantity integer NOT NULL CHECK (quantity > 0),
    line_total_cents integer NOT NULL CHECK (line_total_cents >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ indexes
CREATE INDEX IF NOT EXISTS idx_restaurants_owner
    ON public.restaurants (owner_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant
    ON public.menu_items (restaurant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer
    ON public.orders (customer_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant
    ON public.orders (restaurant_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_orders_courier
    ON public.orders (courier_id, seq DESC);
-- The courier's available pool: `ready` orders nobody has claimed.
CREATE INDEX IF NOT EXISTS idx_orders_unclaimed
    ON public.orders (seq DESC) WHERE courier_id IS NULL;
-- A restaurant's average rating.
CREATE INDEX IF NOT EXISTS idx_orders_rated
    ON public.orders (restaurant_id) WHERE rating_stars IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_lines_order
    ON public.order_lines (order_id, created_at);

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
    FOR obj IN
        SELECT sequencename AS name FROM pg_sequences WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', obj.name, db_owner);
    END LOOP;
END
$$;
