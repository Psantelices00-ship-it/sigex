-- Numeración vinculada, origen (RBD / Infra / Adm. central), documentos adjuntos
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS numero_vinculacion VARCHAR(80);
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS origen_area VARCHAR(64) DEFAULT 'Administración central';
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS establecimiento TEXT;

CREATE INDEX IF NOT EXISTS idx_solicitudes_numero_vinc ON solicitudes(numero_vinculacion);
CREATE INDEX IF NOT EXISTS idx_solicitudes_origen ON solicitudes(origen_area);

UPDATE solicitudes SET origen_area = 'Administración central'
WHERE origen_area IS NULL OR trim(origen_area) = '';

CREATE TABLE IF NOT EXISTS solicitudes_documentos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  solicitud_id UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(100) NOT NULL,
  formato VARCHAR(20) DEFAULT 'PDF',
  version INTEGER DEFAULT 1,
  observacion TEXT,
  file_path TEXT,
  file_size INTEGER,
  mime_type VARCHAR(100),
  cargado_por VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sol_docs_solicitud ON solicitudes_documentos(solicitud_id);

ALTER TABLE solicitudes_historial ADD COLUMN IF NOT EXISTS documento_id UUID REFERENCES solicitudes_documentos(id) ON DELETE SET NULL;
