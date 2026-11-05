-- Cache de extracción OCR/texto de decretos y resoluciones (titularidad)
ALTER TABLE personal_documentos
  ADD COLUMN IF NOT EXISTS extraccion_json jsonb,
  ADD COLUMN IF NOT EXISTS extraccion_at timestamptz;
