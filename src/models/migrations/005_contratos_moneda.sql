-- Unidad de pago del contrato (pesos, UF, USD). Idempotente para bases que ya tenían 004 sin esta columna.
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS moneda VARCHAR(8) DEFAULT 'CLP';
UPDATE contratos SET moneda = 'CLP' WHERE moneda IS NULL OR trim(moneda) = '';
ALTER TABLE contratos ALTER COLUMN objeto SET DEFAULT '';
