-- 029: fechas del contrato desde el maestro (paquete LME, paso 2).
-- Cambio ADITIVO: solo agrega columnas opcionales. No modifica ni borra datos.
--   fecha_documento: "Fecha_Documento" del maestro (fecha del contrato vigente, no docentes).
--   fecha_fin:       "fechafin" del maestro (término de contratos a plazo / contrata).

ALTER TABLE personal_maestro_remuneraciones
  ADD COLUMN IF NOT EXISTS fecha_documento DATE,
  ADD COLUMN IF NOT EXISTS fecha_fin DATE;
