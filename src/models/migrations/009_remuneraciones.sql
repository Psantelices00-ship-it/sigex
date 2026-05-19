-- Períodos de remuneraciones (mes/año) con documentos y ubicación de archivo físico
CREATE TABLE IF NOT EXISTS remuneraciones_periodos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mes INTEGER NOT NULL CHECK (mes >= 1 AND mes <= 12),
  anio INTEGER NOT NULL,
  periodo VARCHAR(40),
  descripcion TEXT,
  monto_total NUMERIC(14,2) DEFAULT 0,
  estado VARCHAR(40) DEFAULT 'Abierto',
  archivo_url TEXT,
  caja VARCHAR(20),
  estante VARCHAR(20),
  posicion VARCHAR(20),
  sala VARCHAR(80),
  fecha_archivo DATE,
  obs_archivo TEXT,
  archivado_por VARCHAR(50),
  creado_por VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (mes, anio)
);

CREATE INDEX IF NOT EXISTS idx_rem_periodos_anio_mes ON remuneraciones_periodos(anio DESC, mes DESC);

CREATE TABLE IF NOT EXISTS remuneraciones_documentos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  periodo_id UUID NOT NULL REFERENCES remuneraciones_periodos(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_rem_docs_periodo ON remuneraciones_documentos(periodo_id);
