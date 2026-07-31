-- Término de contrato y Otros en la carpeta documental vigente (un activo por tipo).

DROP INDEX IF EXISTS idx_personal_documentos_activo_obligatorio;

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
      'certificado_situacion_militar',
      'resolucion_nombramiento',
      'contrato',
      'termino_contrato',
      'otros'
    );
