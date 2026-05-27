-- Monto real de la compra (distinto del monto referencial/estimado en `monto`) y cuenta contable
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS monto_real NUMERIC(14,2);
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS cuenta_contable VARCHAR(60);
