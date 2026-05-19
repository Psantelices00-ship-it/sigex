-- Registro opcional de archivo físico (vista unificada; expedientes también guardan ubicación en su tabla)
CREATE TABLE IF NOT EXISTS archivo_fisico (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero_expediente VARCHAR(40) NOT NULL,
  descripcion TEXT,
  numero_caja VARCHAR(20),
  estante VARCHAR(20),
  posicion VARCHAR(20),
  sala_bodega VARCHAR(80),
  fecha_archivo DATE,
  registrado_por VARCHAR(50),
  modulo_origen VARCHAR(40),
  referencia_id UUID,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archivo_fisico_numero ON archivo_fisico(numero_expediente);
CREATE INDEX IF NOT EXISTS idx_archivo_fisico_caja ON archivo_fisico(numero_caja);
