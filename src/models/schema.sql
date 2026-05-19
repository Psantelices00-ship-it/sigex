CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  login VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  rol VARCHAR(60) NOT NULL,
  area VARCHAR(80),
  activo BOOLEAN DEFAULT true,
  ultimo_acceso TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expedientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero VARCHAR(20) UNIQUE NOT NULL,
  descripcion TEXT NOT NULL,
  solicitante VARCHAR(100) NOT NULL,
  area VARCHAR(80) NOT NULL,
  tipo_gasto VARCHAR(80),
  monto NUMERIC(14,2) DEFAULT 0,
  prioridad VARCHAR(20) DEFAULT 'Normal',
  estado VARCHAR(40) DEFAULT 'Ingresado',
  fecha_ingreso DATE,
  observaciones TEXT,
  creado_por VARCHAR(50),
  caja VARCHAR(20), estante VARCHAR(20), posicion VARCHAR(20),
  sala VARCHAR(80), fecha_archivo DATE, obs_archivo TEXT, archivado_por VARCHAR(50),
  archivo_consolidado_url TEXT,
  archivo_consolidado_public_id TEXT,
  archivo_consolidado_at TIMESTAMP,
  archivo_consolidado_por VARCHAR(50),
  archivo_consolidado_size BIGINT,
  archivo_consolidado_mime VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documentos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expediente_id UUID REFERENCES expedientes(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS historial (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expediente_id UUID REFERENCES expedientes(id) ON DELETE CASCADE,
  usuario VARCHAR(50),
  accion VARCHAR(100),
  nota TEXT,
  tipo VARCHAR(30),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Bandeja de solicitudes (ingreso central; derivación a compras/contratos u otros)
CREATE TABLE IF NOT EXISTS solicitudes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expediente_id UUID REFERENCES expedientes(id) ON DELETE SET NULL,
  numero VARCHAR(32) UNIQUE NOT NULL,
  numero_vinculacion VARCHAR(80),
  descripcion TEXT NOT NULL,
  solicitante VARCHAR(100) NOT NULL,
  area VARCHAR(80) NOT NULL,
  origen_area VARCHAR(64) NOT NULL DEFAULT 'Administración central',
  establecimiento TEXT,
  tipo_gasto VARCHAR(80),
  monto NUMERIC(14,2) DEFAULT 0,
  prioridad VARCHAR(20) DEFAULT 'Normal',
  estado VARCHAR(40) NOT NULL DEFAULT 'Ingresada',
  modulo_destino VARCHAR(40),
  motivo_rechazo TEXT,
  fecha_ingreso DATE,
  observaciones TEXT,
  creado_por VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_expediente ON solicitudes(expediente_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON solicitudes(estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_created ON solicitudes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_solicitudes_numero_vinc ON solicitudes(numero_vinculacion);
CREATE INDEX IF NOT EXISTS idx_solicitudes_origen ON solicitudes(origen_area);

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

CREATE TABLE IF NOT EXISTS solicitudes_historial (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  solicitud_id UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  documento_id UUID REFERENCES solicitudes_documentos(id) ON DELETE SET NULL,
  usuario VARCHAR(50),
  accion VARCHAR(100),
  nota TEXT,
  tipo VARCHAR(30),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_hist_sol ON solicitudes_historial(solicitud_id);

-- Módulo contratos (misma estructura que espera src/routes/contratos.js)
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

INSERT INTO usuarios (login, password_hash, nombre, rol, area) VALUES
  ('admin',       '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Administrador Sistema',   'Super Admin',                    'Administración'),
  ('secretaria',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Carmen López',            'Secretaria de Administración',   'Secretaría'),
  ('contabilidad','$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Roberto Silva',           'Jefe de Contabilidad',           'Contabilidad'),
  ('compras',     '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Paula Morales',           'Encargado de Compras',           'Compras'),
  ('tesoreria',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Felipe Araya',            'Tesorería',                      'Tesorería'),
  ('rendicion',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Valentina Torres',        'Encargada de Rendición',         'Rendición')
ON CONFLICT (login) DO NOTHING;

INSERT INTO usuarios (login, password_hash, nombre, rol, area) VALUES
  ('ingreso_local', '$2a$10$SeF1pfdFyIjHEt7tH.Az.OAKKKttQBjPlQHvZPrpEfrf1Dv/F823S', 'Usuario desarrollo', 'Super Admin', 'Administración')
ON CONFLICT (login) DO NOTHING;
