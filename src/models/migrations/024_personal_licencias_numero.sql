-- Número de licencia del sistema origen (deduplicación en carga masiva)

ALTER TABLE personal_licencias
  ADD COLUMN IF NOT EXISTS numero_licencia VARCHAR(40);

CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_licencias_numero_licencia
  ON personal_licencias (numero_licencia)
  WHERE numero_licencia IS NOT NULL AND trim(numero_licencia) <> '';
