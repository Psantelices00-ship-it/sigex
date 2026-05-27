-- Presupuesto de ingresos (separado de gastos / subtítulo 22)

CREATE TABLE IF NOT EXISTS ingresos_presupuesto_cargas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  anio INTEGER NOT NULL,
  fecha_corte DATE NOT NULL,
  titulo VARCHAR(200),
  archivo_nombre VARCHAR(255),
  subtitulos_filtro VARCHAR(80),
  activa BOOLEAN DEFAULT true,
  cargado_por VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingresos_presupuesto_lineas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  carga_id UUID NOT NULL REFERENCES ingresos_presupuesto_cargas(id) ON DELETE CASCADE,
  subtitulo VARCHAR(4) NOT NULL,
  item VARCHAR(10),
  asig VARCHAR(10),
  sasig VARCHAR(10),
  subasig VARCHAR(10),
  codigo_cuenta VARCHAR(40) NOT NULL,
  denominacion TEXT NOT NULL,
  presup_vigente BIGINT NOT NULL DEFAULT 0,
  ingreso_oficial BIGINT NOT NULL DEFAULT 0,
  ingreso_real BIGINT NOT NULL DEFAULT 0,
  es_imputable BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (carga_id, codigo_cuenta)
);

CREATE INDEX IF NOT EXISTS idx_ingresos_ppto_lineas_carga ON ingresos_presupuesto_lineas(carga_id);
CREATE INDEX IF NOT EXISTS idx_ingresos_ppto_cargas_activa ON ingresos_presupuesto_cargas(activa, anio);
