-- Fecha de la orden de compra (OC) asociada al expediente
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS fecha_oc DATE;
