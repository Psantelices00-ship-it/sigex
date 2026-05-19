-- Bandeja de solicitudes (varias por expediente de compra; derivación a compras/contratos u otros módulos)
CREATE TABLE IF NOT EXISTS solicitudes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expediente_id UUID REFERENCES expedientes(id) ON DELETE SET NULL,
  numero VARCHAR(32) UNIQUE NOT NULL,
  descripcion TEXT NOT NULL,
  solicitante VARCHAR(100) NOT NULL,
  area VARCHAR(80) NOT NULL,
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

CREATE TABLE IF NOT EXISTS solicitudes_historial (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  solicitud_id UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  usuario VARCHAR(50),
  accion VARCHAR(100),
  nota TEXT,
  tipo VARCHAR(30),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_hist_sol ON solicitudes_historial(solicitud_id);
