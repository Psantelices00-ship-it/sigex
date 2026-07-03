-- Tope imponible extraído de la liquidación PDF (para módulo Licencias).

ALTER TABLE personal_liquidaciones_registros
  ADD COLUMN IF NOT EXISTS monto_imponible NUMERIC(14, 2);

CREATE INDEX IF NOT EXISTS idx_personal_liq_reg_imponible
  ON personal_liquidaciones_registros (rut_normalizado, periodo_id)
  WHERE monto_imponible IS NOT NULL;
