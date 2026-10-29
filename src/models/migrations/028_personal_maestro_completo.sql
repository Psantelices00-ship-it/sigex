-- 028: guardar el maestro de remuneraciones completo (para el paquete LME / Portal FONASA).
-- Cambio ADITIVO: solo agrega columnas opcionales. No modifica ni borra datos existentes.
-- Las consultas actuales siguen funcionando igual (las columnas nuevas quedan vacías hasta recargar el maestro).

ALTER TABLE personal_maestro_remuneraciones
  ADD COLUMN IF NOT EXISTS nombre TEXT,
  ADD COLUMN IF NOT EXISTS planta TEXT,
  ADD COLUMN IF NOT EXISTS cargo_especifico TEXT,
  ADD COLUMN IF NOT EXISTS ubicacion TEXT,
  ADD COLUMN IF NOT EXISTS fecha_ingreso DATE,
  ADD COLUMN IF NOT EXISTS jubilado BOOLEAN,
  ADD COLUMN IF NOT EXISTS cotiza_desahucio BOOLEAN,
  ADD COLUMN IF NOT EXISTS dias_trabajados INT,
  ADD COLUMN IF NOT EXISTS monto_imponible NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS monto_imp_desahucio NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS total_haberes NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS haberes JSONB;

COMMENT ON COLUMN personal_maestro_remuneraciones.haberes IS
  'Haberes del mes distintos de 0: { "H001": { "glosa": "SUELDOS", "monto": 557700 }, ... }';
