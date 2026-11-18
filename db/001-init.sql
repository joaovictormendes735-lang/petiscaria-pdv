CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
 username text NOT NULL UNIQUE,
 password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('admin','operator')),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id),
 csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_attempts (key text PRIMARY KEY, failures integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS categories (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 50)
);
CREATE TABLE IF NOT EXISTS products (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 category_id integer NOT NULL REFERENCES categories(id),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
 price_cents integer NOT NULL CHECK (price_cents BETWEEN 1 AND 10000000),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS settings (
 id integer PRIMARY KEY CHECK (id=1), store_name text NOT NULL DEFAULT 'Petiscaria',
 paper_width integer NOT NULL DEFAULT 80 CHECK (paper_width IN (58,80)),
 auto_print boolean NOT NULL DEFAULT false,
 timezone text NOT NULL DEFAULT 'America/Sao_Paulo'
);
INSERT INTO settings(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS orders (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 user_id integer NOT NULL REFERENCES users(id),
 request_key uuid NOT NULL UNIQUE,
 request_hash text NOT NULL,
 total_cents integer NOT NULL CHECK (total_cents > 0),
 payment text NOT NULL CHECK (payment IN ('pix','cash','debit','credit')),
 received_cents integer NOT NULL CHECK (received_cents >= total_cents),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','preparing','ready','delivered')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS orders_queue ON orders(status,created_at);
CREATE TABLE IF NOT EXISTS order_items (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id bigint NOT NULL REFERENCES orders(id), product_id integer NOT NULL REFERENCES products(id),
 name text NOT NULL, quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
 price_cents integer NOT NULL CHECK (price_cents > 0)
);
CREATE INDEX IF NOT EXISTS items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id integer NOT NULL REFERENCES users(id), action text NOT NULL,
 entity_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
