-- Liquidaciones de remuneraciones (consulta Personal): carga mensual PDF + índice por funcionario.

CREATE TABLE IF NOT EXISTS personal_liquidaciones_periodos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  anio INTEGER NOT NULL CHECK (anio >= 2000 AND anio <= 2100),
  etiqueta VARCHAR(120),
  establecimiento TEXT,
  nombre_archivo VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  cloudinary_public_id TEXT,
  file_size INTEGER,
  total_paginas INTEGER NOT NULL DEFAULT 0,
  total_registros INTEGER NOT NULL DEFAULT 0,
  estado VARCHAR(30) NOT NULL DEFAULT 'procesando'
    CHECK (estado IN ('procesando', 'completo', 'error')),
  error_mensaje TEXT,
  cargado_por VARCHAR(120),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_liq_periodo_mes_anio_est
  ON personal_liquidaciones_periodos (mes, anio, COALESCE(establecimiento, ''));

CREATE INDEX IF NOT EXISTS idx_personal_liq_periodo_estado ON personal_liquidaciones_periodos (estado);
CREATE INDEX IF NOT EXISTS idx_personal_liq_periodo_fecha ON personal_liquidaciones_periodos (anio DESC, mes DESC);

CREATE TABLE IF NOT EXISTS personal_liquidaciones_registros (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  periodo_id UUID NOT NULL REFERENCES personal_liquidaciones_periodos(id) ON DELETE CASCADE,
  pagina INTEGER NOT NULL CHECK (pagina >= 1),
  rut_normalizado VARCHAR(9),
  rut_display VARCHAR(14),
  apellido_paterno TEXT,
  apellido_materno TEXT,
  nombres TEXT,
  nombre_completo TEXT,
  cargo TEXT,
  establecimiento TEXT,
  funcionario_id UUID REFERENCES personal_funcionarios(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (periodo_id, pagina)
);

CREATE INDEX IF NOT EXISTS idx_personal_liq_reg_rut ON personal_liquidaciones_registros (rut_normalizado);
CREATE INDEX IF NOT EXISTS idx_personal_liq_reg_periodo ON personal_liquidaciones_registros (periodo_id);
CREATE INDEX IF NOT EXISTS idx_personal_liq_reg_funcionario ON personal_liquidaciones_registros (funcionario_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_liq_reg_periodo_rut
  ON personal_liquidaciones_registros (periodo_id, rut_normalizado)
  WHERE rut_normalizado IS NOT NULL AND rut_normalizado <> '';
