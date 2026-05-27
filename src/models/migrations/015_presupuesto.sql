-- Ejecución presupuestaria (importación Excel) y seguimiento de compromisos SIGEX

CREATE TABLE IF NOT EXISTS presupuesto_cargas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  anio INTEGER NOT NULL,
  fecha_corte DATE NOT NULL,
  titulo VARCHAR(200),
  archivo_nombre VARCHAR(255),
  subtitulo_filtro VARCHAR(10) DEFAULT '22',
  activa BOOLEAN DEFAULT true,
  cargado_por VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS presupuesto_lineas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  carga_id UUID NOT NULL REFERENCES presupuesto_cargas(id) ON DELETE CASCADE,
  subtitulo VARCHAR(4) NOT NULL,
  item VARCHAR(10),
  asig VARCHAR(10),
  sasig VARCHAR(10),
  subasig VARCHAR(10),
  codigo_cuenta VARCHAR(40) NOT NULL,
  denominacion TEXT NOT NULL,
  presup_inicial BIGINT NOT NULL DEFAULT 0,
  presup_vigente BIGINT NOT NULL DEFAULT 0,
  devengado BIGINT NOT NULL DEFAULT 0,
  saldo_oficial BIGINT NOT NULL DEFAULT 0,
  deuda_exigible BIGINT NOT NULL DEFAULT 0,
  es_imputable BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (carga_id, codigo_cuenta)
);

CREATE INDEX IF NOT EXISTS idx_presupuesto_lineas_carga ON presupuesto_lineas(carga_id);
CREATE INDEX IF NOT EXISTS idx_presupuesto_lineas_codigo ON presupuesto_lineas(codigo_cuenta);
CREATE INDEX IF NOT EXISTS idx_presupuesto_cargas_activa ON presupuesto_cargas(activa, anio);
