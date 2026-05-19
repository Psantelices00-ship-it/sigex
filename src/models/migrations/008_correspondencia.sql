-- Registro de correspondencia entrante y saliente (documentos digitales)
CREATE TABLE IF NOT EXISTS correspondencia (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sentido VARCHAR(10) NOT NULL CHECK (sentido IN ('RECIBIDO', 'ENVIADO')),
  fecha DATE NOT NULL,
  contraparte VARCHAR(200) NOT NULL,
  numero_documento VARCHAR(80) NOT NULL,
  tipo_documento VARCHAR(20) NOT NULL,
  tenor TEXT NOT NULL,
  observacion TEXT,
  archivo_nombre VARCHAR(200),
  file_path TEXT,
  file_size INTEGER,
  mime_type VARCHAR(100),
  formato VARCHAR(20) DEFAULT 'PDF',
  registrado_por VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_correspondencia_sentido ON correspondencia(sentido);
CREATE INDEX IF NOT EXISTS idx_correspondencia_fecha ON correspondencia(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_correspondencia_numero ON correspondencia(numero_documento);
