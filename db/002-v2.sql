ALTER TABLE products ADD COLUMN available boolean NOT NULL DEFAULT true;
ALTER TABLE products ADD COLUMN display_order integer NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN deleted_at timestamptz;
ALTER TABLE settings ADD COLUMN primary_color text NOT NULL DEFAULT '#16A34A';
ALTER TABLE settings ADD COLUMN logo_data_url text NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN receipt_message text NOT NULL DEFAULT 'AGUARDE CHAMAR SEU NÚMERO';
ALTER TABLE settings ADD COLUMN business_info text NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN pickup_message text NOT NULL DEFAULT 'RETIRE SEU PEDIDO NO BALCÃO';
ALTER TABLE settings ADD COLUMN require_open_cash boolean NOT NULL DEFAULT false;
CREATE TABLE cash_sessions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 opened_at timestamptz NOT NULL DEFAULT now(), opened_by integer NOT NULL REFERENCES users(id),
 opening_cents integer NOT NULL CHECK (opening_cents BETWEEN 0 AND 100000000),
 open_request_key uuid NOT NULL UNIQUE,
 closed_at timestamptz, closed_by integer REFERENCES users(id),
 expected_cents bigint, counted_cents integer CHECK (counted_cents BETWEEN 0 AND 100000000),
 difference_cents bigint, closing_summary jsonb
);
CREATE UNIQUE INDEX one_open_cash ON cash_sessions ((closed_at IS NULL)) WHERE closed_at IS NULL;
ALTER TABLE orders ADD COLUMN notes text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0);
ALTER TABLE orders ADD COLUMN subtotal_cents integer;
ALTER TABLE orders ADD COLUMN cash_session_id bigint REFERENCES cash_sessions(id);
ALTER TABLE orders ADD COLUMN ready_at timestamptz;
ALTER TABLE orders ADD COLUMN cancelled_at timestamptz;
ALTER TABLE orders ADD COLUMN cancelled_by integer REFERENCES users(id);
ALTER TABLE orders ADD COLUMN cancel_reason text NOT NULL DEFAULT '';
CREATE INDEX orders_cash ON orders(cash_session_id) WHERE cash_session_id IS NOT NULL;
CREATE INDEX orders_user_history ON orders(user_id,id DESC);
CREATE INDEX orders_ready ON orders(ready_at DESC) WHERE ready_at IS NOT NULL AND cancelled_at IS NULL;
CREATE INDEX products_display ON products(display_order,id) WHERE active=true AND deleted_at IS NULL;
INSERT INTO schema_migrations(version) VALUES (2);
