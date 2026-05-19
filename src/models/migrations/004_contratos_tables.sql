-- Tablas del módulo contratos (crear si no existen). Ejecutar si aparece "relation contratos does not exist".

CREATE TABLE IF NOT EXISTS contratos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero VARCHAR(30) UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  proveedor VARCHAR(200) NOT NULL,
  rut_proveedor VARCHAR(20),
  monto_total NUMERIC(14,2) DEFAULT 0,
  monto_mensual NUMERIC(14,2) DEFAULT 0,
  moneda VARCHAR(8) DEFAULT 'CLP',
  fecha_inicio DATE,
  fecha_termino DATE,
  area VARCHAR(80) NOT NULL,
  objeto TEXT NOT NULL DEFAULT '',
  observaciones TEXT,
  estado VARCHAR(40) DEFAULT 'Vigente',
  creado_por VARCHAR(50),
  archivo_madre_consolidado_url TEXT,
  archivo_madre_consolidado_public_id TEXT,
  archivo_madre_consolidado_at TIMESTAMP,
  archivo_madre_consolidado_por VARCHAR(50),
  archivo_madre_consolidado_size BIGINT,
  archivo_madre_consolidado_mime VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contratos_documentos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contrato_id UUID NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_contratos_documentos_contrato ON contratos_documentos(contrato_id);

CREATE TABLE IF NOT EXISTS contratos_pagos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contrato_id UUID NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
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
  archivo_mes_consolidado_url TEXT,
  archivo_mes_consolidado_public_id TEXT,
  archivo_mes_consolidado_at TIMESTAMP,
  archivo_mes_consolidado_por VARCHAR(50),
  archivo_mes_consolidado_size BIGINT,
  archivo_mes_consolidado_mime VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (contrato_id, mes, anio)
);

CREATE INDEX IF NOT EXISTS idx_contratos_pagos_contrato ON contratos_pagos(contrato_id);

CREATE TABLE IF NOT EXISTS contratos_pagos_docs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pago_id UUID NOT NULL REFERENCES contratos_pagos(id) ON DELETE CASCADE,
  contrato_id UUID NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_contratos_pagos_docs_pago ON contratos_pagos_docs(pago_id);
CREATE INDEX IF NOT EXISTS idx_contratos_pagos_docs_contrato ON contratos_pagos_docs(contrato_id);

CREATE TABLE IF NOT EXISTS contratos_historial (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contrato_id UUID NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  usuario VARCHAR(50),
  accion VARCHAR(100),
  nota TEXT,
  tipo VARCHAR(30),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contratos_historial_contrato ON contratos_historial(contrato_id);
