-- Número de orden (máx. 10 dígitos), mismo valor que la referencia obligatoria
CREATE SEQUENCE IF NOT EXISTS order_number_seq;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number INTEGER;

-- Rellenar órdenes existentes con números únicos
WITH numbered AS (
  SELECT id, nextval('order_number_seq') AS n FROM orders WHERE order_number IS NULL
)
UPDATE orders SET order_number = numbered.n FROM numbered WHERE orders.id = numbered.id;

ALTER TABLE orders ALTER COLUMN order_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_idx ON orders(order_number);

ALTER TABLE orders ALTER COLUMN order_number SET DEFAULT nextval('order_number_seq');
