-- Maestro mensual de remuneraciones (Excel) + historial de licencias médicas

CREATE TABLE IF NOT EXISTS personal_maestro_remuneraciones_periodos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  anio INT NOT NULL CHECK (anio >= 2000),
  nombre_archivo TEXT,
  total_registros INT NOT NULL DEFAULT 0,
  cargado_por VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mes, anio)
);

CREATE INDEX IF NOT EXISTS idx_maestro_rem_periodos_anio_mes
  ON personal_maestro_remuneraciones_periodos (anio DESC, mes DESC);

CREATE TABLE IF NOT EXISTS personal_maestro_remuneraciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_id UUID NOT NULL REFERENCES personal_maestro_remuneraciones_periodos(id) ON DELETE CASCADE,
  funcionario_id UUID REFERENCES personal_funcionarios(id) ON DELETE SET NULL,
  rut_normalizado VARCHAR(9) NOT NULL,
  fondo TEXT,
  salud TEXT,
  tipo_contrato TEXT,
  imposiciones NUMERIC(14, 2),
  seg_cesantia_emp NUMERIC(14, 2),
  sueldos NUMERIC(14, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (periodo_id, rut_normalizado)
);

CREATE INDEX IF NOT EXISTS idx_maestro_rem_rut ON personal_maestro_remuneraciones (rut_normalizado);
CREATE INDEX IF NOT EXISTS idx_maestro_rem_funcionario ON personal_maestro_remuneraciones (funcionario_id);

CREATE TABLE IF NOT EXISTS personal_licencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id UUID NOT NULL REFERENCES personal_funcionarios(id) ON DELETE CASCADE,
  fecha_tramitacion DATE,
  fecha_inicio DATE NOT NULL,
  fecha_termino DATE NOT NULL,
  dias INT,
  notas TEXT,
  created_by VARCHAR(120),
  updated_by VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_licencias_funcionario
  ON personal_licencias (funcionario_id, fecha_inicio DESC);
