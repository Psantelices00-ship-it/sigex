-- Talonarios, cheques emitidos y cartolas bancarias
CREATE TABLE IF NOT EXISTS cheques_talonarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre VARCHAR(120) NOT NULL,
  banco VARCHAR(120),
  numero_desde INTEGER NOT NULL,
  numero_hasta INTEGER NOT NULL,
  observacion TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cheques_emitidos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  talonario_id UUID REFERENCES cheques_talonarios(id) ON DELETE SET NULL,
  numero_cheque VARCHAR(30) NOT NULL,
  beneficiario VARCHAR(200) NOT NULL,
  monto NUMERIC(14,2),
  fecha_emision DATE NOT NULL,
  tipo_pago VARCHAR(30) DEFAULT 'OTRO',
  banco_emisor VARCHAR(120),
  observacion TEXT,
  estado VARCHAR(20) DEFAULT 'emitido',
  cartola_id UUID,
  fecha_cobro_cartola DATE,
  match_cartola JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cheques_emitidos_num ON cheques_emitidos(numero_cheque);
CREATE INDEX IF NOT EXISTS idx_cheques_emitidos_estado ON cheques_emitidos(estado);

CREATE TABLE IF NOT EXISTS cheques_cartolas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre VARCHAR(200) NOT NULL,
  observacion TEXT,
  file_path TEXT,
  bytes_pdf INTEGER,
  movimientos_total INTEGER DEFAULT 0,
  movimientos_cheque_detectados INTEGER DEFAULT 0,
  movimientos_parseados JSONB DEFAULT '[]'::jsonb,
  resultado_conciliacion JSONB,
  fecha_importacion TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE cheques_emitidos DROP CONSTRAINT IF EXISTS cheques_emitidos_cartola_id_fkey;
ALTER TABLE cheques_emitidos
  ADD CONSTRAINT cheques_emitidos_cartola_id_fkey
  FOREIGN KEY (cartola_id) REFERENCES cheques_cartolas(id) ON DELETE SET NULL;
