-- Consolidado antiguo: PDFs de importación masiva separados de la carpeta documental obligatoria.

ALTER TABLE personal_documentos
  ADD COLUMN IF NOT EXISTS origen_carga VARCHAR(30) NOT NULL DEFAULT 'manual'
    CHECK (origen_carga IN ('manual', 'importacion_masiva'));

DROP INDEX IF EXISTS idx_personal_documentos_activo_por_tipo;

CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_documentos_activo_obligatorio
  ON personal_documentos (funcionario_id, tipo_documental)
  WHERE es_activo = TRUE
    AND tipo_documental IN (
      'curriculum',
      'certificado_estudios',
      'certificado_antecedentes',
      'certificado_nacimiento',
      'certificado_inhabilidad_menores',
      'cedula_identidad',
      'certificado_salud',
      'certificado_afp',
      'certificado_prevision',
      'certificado_situacion_militar'
    );

CREATE INDEX IF NOT EXISTS idx_personal_documentos_origen
  ON personal_documentos (funcionario_id, origen_carga)
  WHERE es_activo = TRUE;
