ALTER TABLE products ADD COLUMN is_combo boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN combo_version integer NOT NULL DEFAULT 1;
CREATE TABLE combo_items (
 product_id integer NOT NULL REFERENCES products(id),
 child_product_id integer NOT NULL REFERENCES products(id),
 quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
 PRIMARY KEY(product_id,child_product_id), CHECK(product_id<>child_product_id)
);
CREATE TABLE held_orders (
 id uuid PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id),
 label text NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 consumed_at timestamptz, discarded_at timestamptz
);
CREATE INDEX held_user_open ON held_orders(user_id,created_at DESC) WHERE consumed_at IS NULL AND discarded_at IS NULL;
ALTER TABLE orders ADD COLUMN suspended_id uuid UNIQUE REFERENCES held_orders(id);
ALTER TABLE orders ADD COLUMN payment_parts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE orders DROP CONSTRAINT orders_payment_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_check CHECK (payment IN ('pix','cash','debit','credit','mixed'));
ALTER TABLE order_items ADD COLUMN notes text NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN combo_components jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE cash_movements (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cash_session_id bigint NOT NULL REFERENCES cash_sessions(id),
 user_id integer NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK (kind IN ('in','out')),
 amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
 request_key uuid NOT NULL UNIQUE, request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_movements_shift ON cash_movements(cash_session_id,id DESC);
ALTER TABLE settings ADD COLUMN attention_minutes integer NOT NULL DEFAULT 10 CHECK(attention_minutes BETWEEN 1 AND 180);
ALTER TABLE settings ADD COLUMN late_minutes integer NOT NULL DEFAULT 20 CHECK(late_minutes BETWEEN 2 AND 480);
ALTER TABLE settings ADD CONSTRAINT order_time_limits CHECK(late_minutes>attention_minutes);
INSERT INTO schema_migrations(version) VALUES (3);
