-- Honorarios (estructura similar a contratos: documentos base + pagos mensuales)
CREATE TABLE IF NOT EXISTS honorarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero VARCHAR(30) UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  objeto TEXT,
  profesional VARCHAR(200) NOT NULL,
  rut_profesional VARCHAR(20),
  monto_mensual NUMERIC(14,2) DEFAULT 0,
  moneda VARCHAR(8) DEFAULT 'CLP',
  fecha_inicio DATE,
  fecha_termino DATE,
  area VARCHAR(80),
  observaciones TEXT,
  estado VARCHAR(40) DEFAULT 'Vigente',
  creado_por VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_honorarios_estado ON honorarios(estado);

CREATE TABLE IF NOT EXISTS honorarios_documentos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  honorario_id UUID NOT NULL REFERENCES honorarios(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_honorarios_docs_hon ON honorarios_documentos(honorario_id);

CREATE TABLE IF NOT EXISTS honorarios_pagos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  honorario_id UUID NOT NULL REFERENCES honorarios(id) ON DELETE CASCADE,
  mes INTEGER NOT NULL,
  anio INTEGER NOT NULL,
  periodo VARCHAR(80) NOT NULL,
  monto NUMERIC(14,2) DEFAULT 0,
  estado VARCHAR(40) DEFAULT 'Pendiente',
  observaciones TEXT,
  creado_por VARCHAR(50),
  caja VARCHAR(20),
  estante VARCHAR(20),
  posicion VARCHAR(20),
  sala VARCHAR(80),
  fecha_archivo DATE,
  obs_archivo TEXT,
  archivado_por VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (honorario_id, mes, anio)
);

CREATE INDEX IF NOT EXISTS idx_honorarios_pagos_hon ON honorarios_pagos(honorario_id);

CREATE TABLE IF NOT EXISTS honorarios_pagos_docs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pago_id UUID NOT NULL REFERENCES honorarios_pagos(id) ON DELETE CASCADE,
  honorario_id UUID NOT NULL REFERENCES honorarios(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_honorarios_pagos_docs_pago ON honorarios_pagos_docs(pago_id);
