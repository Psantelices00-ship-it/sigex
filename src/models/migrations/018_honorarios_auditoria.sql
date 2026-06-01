CREATE TABLE IF NOT EXISTS honorarios_auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  honorario_id UUID NOT NULL REFERENCES honorarios(id) ON DELETE CASCADE,
  usuario TEXT,
  cambios JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_honorarios_auditoria_hon ON honorarios_auditoria(honorario_id);
CREATE INDEX IF NOT EXISTS idx_honorarios_auditoria_created ON honorarios_auditoria(created_at DESC);
