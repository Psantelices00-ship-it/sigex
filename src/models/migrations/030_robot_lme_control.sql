-- 030: control y registro del Robot LME (tramitación de licencias en el Portal FONASA / PIEE).
-- Cambio ADITIVO: crea 3 tablas nuevas. No modifica ni borra datos existentes.
--   robot_lme_control : el interruptor (una sola fila). Lo cambia el administrador desde SIGEX.
--   robot_lme_latido  : último contacto del robot (para saber si está vivo).
--   robot_lme_eventos : cada licencia que el robot procesó (tramitada / lista / detenida). Base del reporte diario y del SMC.

CREATE TABLE IF NOT EXISTS robot_lme_control (
  id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  modo            TEXT NOT NULL DEFAULT 'apagado' CHECK (modo IN ('apagado', 'llenar', 'tramitar')),
  hora_inicio     TIME NOT NULL DEFAULT '08:00',
  hora_fin        TIME NOT NULL DEFAULT '22:00',
  intervalo_min   INTEGER NOT NULL DEFAULT 15 CHECK (intervalo_min BETWEEN 5 AND 120),
  correo_reporte  TEXT,
  actualizado_por TEXT,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO robot_lme_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS robot_lme_latido (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  visto_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estado     TEXT,      -- 'esperando' | 'trabajando' | 'fuera_de_horario' | 'apagado' | 'error' | 'sin_sesion_portal'
  mensaje    TEXT,
  equipo     TEXT,
  version    TEXT
);

CREATE TABLE IF NOT EXISTS robot_lme_eventos (
  id          SERIAL PRIMARY KEY,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  folio       TEXT NOT NULL,
  operador    TEXT,
  rut         TEXT,
  nombre      TEXT,
  tipo        TEXT,
  fecha_inicio DATE,
  fecha_fin   DATE,
  dias        INTEGER,
  resultado   TEXT NOT NULL CHECK (resultado IN ('TRAMITADA', 'LISTA', 'DETENIDO', 'ERROR')),
  motivo      TEXT,
  detalle     JSONB
);
CREATE INDEX IF NOT EXISTS robot_lme_eventos_creado_idx ON robot_lme_eventos (creado_en);
CREATE INDEX IF NOT EXISTS robot_lme_eventos_folio_idx ON robot_lme_eventos (folio);
