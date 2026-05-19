-- PDF consolidado del expediente (único volumen para archivo físico). Ejecutar en DB existente.
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS archivo_consolidado_url TEXT;
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS archivo_consolidado_public_id TEXT;
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS archivo_consolidado_at TIMESTAMP;
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS archivo_consolidado_por VARCHAR(50);
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS archivo_consolidado_size BIGINT;
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS archivo_consolidado_mime VARCHAR(100);
