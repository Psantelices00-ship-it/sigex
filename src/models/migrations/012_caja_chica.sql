-- Caja chica: fondos, períodos, giros, gastos y documentos
CREATE TABLE IF NOT EXISTS caja_chica_cajas (
  id VARCHAR(64) PRIMARY KEY,
  nombre VARCHAR(200) NOT NULL,
  area VARCHAR(80) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO caja_chica_cajas (id, nombre, area) VALUES
  ('cc-administracion', 'Caja chica — Administración', 'Administración'),
  ('cc-infraestructura', 'Caja chica — Infraestructura', 'Infraestructura')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS caja_chica_periodos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caja_id VARCHAR(64) NOT NULL REFERENCES caja_chica_cajas(id) ON DELETE CASCADE,
  etiqueta VARCHAR(80) NOT NULL,
  mes INTEGER NOT NULL,
  anio INTEGER NOT NULL,
  estado VARCHAR(20) DEFAULT 'abierto',
  saldo_inicial NUMERIC(14,2) DEFAULT 0,
  observaciones_cuadratura TEXT DEFAULT '',
  fecha_rendicion DATE,
  numero_rendicion VARCHAR(80) DEFAULT '',
  fecha_cierre_iso TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cc_periodos_caja ON caja_chica_periodos(caja_id);

CREATE TABLE IF NOT EXISTS caja_chica_giros (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  periodo_id UUID NOT NULL REFERENCES caja_chica_periodos(id) ON DELETE CASCADE,
  monto NUMERIC(14,2) DEFAULT 0,
  concepto TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS caja_chica_gastos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  periodo_id UUID NOT NULL REFERENCES caja_chica_periodos(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  tipo_gasto VARCHAR(40) DEFAULT 'OTRO',
  numero_boleta VARCHAR(40),
  rut_proveedor VARCHAR(20),
  proveedor VARCHAR(200),
  funcionario VARCHAR(120),
  motivo_destino TEXT,
  concepto TEXT,
  monto NUMERIC(14,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS caja_chica_documentos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  periodo_id UUID NOT NULL REFERENCES caja_chica_periodos(id) ON DELETE CASCADE,
  clase VARCHAR(40) NOT NULL,
  ref_id VARCHAR(64),
  nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(100),
  formato VARCHAR(20) DEFAULT 'PDF',
  observacion TEXT,
  file_path TEXT,
  file_size INTEGER,
  mime_type VARCHAR(100),
  cargado_por VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cc_docs_periodo ON caja_chica_documentos(periodo_id);
