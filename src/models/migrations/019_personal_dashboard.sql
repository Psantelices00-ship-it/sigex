-- Dashboard de Personal: funcionarios, carpetas digitales, resoluciones, auditoría e importaciones.

CREATE TABLE IF NOT EXISTS personal_funcionarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rut_normalizado VARCHAR(9) NOT NULL UNIQUE,
  rut_numero VARCHAR(8) NOT NULL,
  rut_dv CHAR(1) NOT NULL,
  nombre_completo TEXT NOT NULL,
  tipo_funcionario VARCHAR(30) NOT NULL CHECK (tipo_funcionario IN ('docente', 'asistente')),
  estado_laboral VARCHAR(30) NOT NULL DEFAULT 'activo' CHECK (estado_laboral IN ('activo', 'inactivo')),
  planta VARCHAR(120),
  ubicacion TEXT,
  fecha_ingreso DATE,
  fecha_nacimiento DATE,
  profesion VARCHAR(200),
  tipo_contrato VARCHAR(80),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by VARCHAR(120),
  updated_by VARCHAR(120)
);

CREATE INDEX IF NOT EXISTS idx_personal_funcionarios_rut_numero ON personal_funcionarios (rut_numero);
CREATE INDEX IF NOT EXISTS idx_personal_funcionarios_nombre ON personal_funcionarios (nombre_completo);
CREATE INDEX IF NOT EXISTS idx_personal_funcionarios_tipo ON personal_funcionarios (tipo_funcionario);
CREATE INDEX IF NOT EXISTS idx_personal_funcionarios_estado ON personal_funcionarios (estado_laboral);
CREATE INDEX IF NOT EXISTS idx_personal_funcionarios_activo ON personal_funcionarios (activo);

CREATE TABLE IF NOT EXISTS personal_documentos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  funcionario_id UUID NOT NULL REFERENCES personal_funcionarios(id) ON DELETE CASCADE,
  tipo_documental VARCHAR(60) NOT NULL,
  version_num INTEGER NOT NULL DEFAULT 1,
  es_activo BOOLEAN NOT NULL DEFAULT TRUE,
  nombre_archivo VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  cloudinary_public_id TEXT,
  fecha_vencimiento DATE,
  estado VARCHAR(30) NOT NULL DEFAULT 'vigente'
    CHECK (estado IN ('vigente', 'proximo_vencer', 'vencido', 'pendiente')),
  cargado_por VARCHAR(120),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_documentos_activo_por_tipo
  ON personal_documentos (funcionario_id, tipo_documental)
  WHERE es_activo = TRUE;

CREATE INDEX IF NOT EXISTS idx_personal_documentos_funcionario ON personal_documentos (funcionario_id);
CREATE INDEX IF NOT EXISTS idx_personal_documentos_tipo ON personal_documentos (tipo_documental);

CREATE TABLE IF NOT EXISTS personal_plantillas_resolucion (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo VARCHAR(60) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  tipo_resolucion VARCHAR(40) NOT NULL,
  tipo_personal VARCHAR(30) NOT NULL CHECK (tipo_personal IN ('docente', 'asistente')),
  version_num INTEGER NOT NULL DEFAULT 1,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  file_path TEXT,
  cloudinary_public_id TEXT,
  campos_json JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by VARCHAR(120),
  updated_by VARCHAR(120)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_plantillas_codigo_version
  ON personal_plantillas_resolucion (codigo, version_num);

CREATE TABLE IF NOT EXISTS personal_resoluciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  funcionario_id UUID NOT NULL REFERENCES personal_funcionarios(id) ON DELETE RESTRICT,
  plantilla_id UUID REFERENCES personal_plantillas_resolucion(id) ON DELETE SET NULL,
  numero_resolucion INTEGER NOT NULL,
  tipo_resolucion VARCHAR(40) NOT NULL,
  tipo_personal VARCHAR(30) NOT NULL,
  datos_json JSONB NOT NULL DEFAULT '{}',
  file_path TEXT,
  file_size INTEGER,
  cloudinary_public_id TEXT,
  generado_por VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_resoluciones_funcionario ON personal_resoluciones (funcionario_id);
CREATE INDEX IF NOT EXISTS idx_personal_resoluciones_numero ON personal_resoluciones (numero_resolucion);

CREATE TABLE IF NOT EXISTS personal_auditoria (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_login VARCHAR(120) NOT NULL,
  usuario_nombre VARCHAR(200),
  ip VARCHAR(64),
  accion VARCHAR(80) NOT NULL,
  entidad VARCHAR(60),
  entidad_id VARCHAR(64),
  funcionario_id UUID REFERENCES personal_funcionarios(id) ON DELETE SET NULL,
  documento_id UUID REFERENCES personal_documentos(id) ON DELETE SET NULL,
  detalle_json JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_auditoria_created ON personal_auditoria (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_auditoria_funcionario ON personal_auditoria (funcionario_id);
CREATE INDEX IF NOT EXISTS idx_personal_auditoria_accion ON personal_auditoria (accion);

CREATE TABLE IF NOT EXISTS personal_importaciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo VARCHAR(40) NOT NULL DEFAULT 'carpetas_masivas',
  estado VARCHAR(30) NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'procesando', 'completado', 'error', 'cancelado')),
  usuario_login VARCHAR(120) NOT NULL,
  inicio TIMESTAMP NOT NULL DEFAULT NOW(),
  fin TIMESTAMP,
  resumen_json JSONB DEFAULT '{}',
  error_mensaje TEXT
);

CREATE INDEX IF NOT EXISTS idx_personal_importaciones_estado ON personal_importaciones (estado);
