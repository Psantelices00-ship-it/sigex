/** Tipos documentales obligatorios de la carpeta funcionaria (solo PDF, carga manual). */

const PERSONAL_DOC_TIPOS_OBLIGATORIOS = [
  { key: 'curriculum', label: 'Currículum Vitae', requiere_vencimiento: false, solo_hombres: false },
  { key: 'certificado_estudios', label: 'Certificado de estudios y/o título profesional', requiere_vencimiento: false, solo_hombres: false },
  { key: 'certificado_antecedentes', label: 'Certificado de antecedentes', requiere_vencimiento: true, solo_hombres: false },
  { key: 'certificado_nacimiento', label: 'Certificado de nacimiento', requiere_vencimiento: false, solo_hombres: false },
  { key: 'certificado_inhabilidad_menores', label: 'Certificado de inhabilidad para trabajar con menores', requiere_vencimiento: true, solo_hombres: false },
  { key: 'cedula_identidad', label: 'Cédula de identidad (ambos lados)', requiere_vencimiento: false, solo_hombres: false },
  { key: 'certificado_salud', label: 'Certificado médico de salud compatible', requiere_vencimiento: true, solo_hombres: false },
  { key: 'certificado_afp', label: 'Certificado de incorporación a AFP', requiere_vencimiento: false, solo_hombres: false },
  { key: 'certificado_prevision', label: 'Certificado de Isapre o Fonasa', requiere_vencimiento: false, solo_hombres: false },
  { key: 'certificado_situacion_militar', label: 'Certificado de situación militar', requiere_vencimiento: false, solo_hombres: true },
  { key: 'resolucion_nombramiento', label: 'Resolución de nombramiento', requiere_vencimiento: false, solo_hombres: false },
  { key: 'contrato', label: 'Contrato', requiere_vencimiento: false, solo_hombres: false, solo_asistentes: true },
];

/** Anexos: carga manual, varios activos por funcionario. */
const PERSONAL_DOC_TIPOS_ANEXOS = [
  {
    key: 'anexo',
    label: 'Anexo',
    requiere_vencimiento: false,
    solo_hombres: false,
    multiples_activos: true,
  },
];

/** PDFs digitalizados en bloque (TOSHIBA); no reemplazan la carpeta documental vigente. */
const PERSONAL_DOC_TIPOS_IMPORTACION = [
  {
    key: 'consolidado_antiguo',
    label: 'Consolidado antiguo (importación masiva)',
    requiere_vencimiento: false,
    solo_hombres: false,
    multiples_activos: true,
  },
];

const PERSONAL_DOC_TIPOS = [
  ...PERSONAL_DOC_TIPOS_OBLIGATORIOS,
  ...PERSONAL_DOC_TIPOS_ANEXOS,
  ...PERSONAL_DOC_TIPOS_IMPORTACION,
];

const KEYS = new Set(PERSONAL_DOC_TIPOS.map((t) => t.key));
const OBLIGATORIOS = new Set(PERSONAL_DOC_TIPOS_OBLIGATORIOS.map((t) => t.key));
const MULTIPLES_ACTIVOS = new Set(
  PERSONAL_DOC_TIPOS.filter((t) => t.multiples_activos).map((t) => t.key)
);

function isTipoDocumentalValido(key) {
  return KEYS.has(String(key || '').trim());
}

function isTipoObligatorio(key) {
  return OBLIGATORIOS.has(String(key || '').trim());
}

function isTipoAnexo(key) {
  return String(key || '').trim() === 'anexo';
}

function isTipoCargaManual(key) {
  return isTipoObligatorio(key) || isTipoAnexo(key);
}

function permiteMultiplesActivos(key) {
  return MULTIPLES_ACTIVOS.has(String(key || '').trim());
}

function tipoDocumentalLabel(key) {
  return PERSONAL_DOC_TIPOS.find((t) => t.key === key)?.label || key;
}

function tiposObligatoriosParaFuncionario(tipoFuncionario) {
  const tipo = tipoFuncionario === 'docente' ? 'docente' : 'asistente';
  return PERSONAL_DOC_TIPOS_OBLIGATORIOS.filter((t) => {
    if (t.solo_asistentes && tipo !== 'asistente') return false;
    if (t.solo_docentes && tipo !== 'docente') return false;
    return true;
  });
}

function tipoPermitidoParaFuncionario(tipoKey, tipoFuncionario) {
  if (!isTipoCargaManual(tipoKey)) return false;
  const meta = PERSONAL_DOC_TIPOS.find((t) => t.key === tipoKey);
  if (!meta) return false;
  const tipo = tipoFuncionario === 'docente' ? 'docente' : 'asistente';
  if (meta.solo_asistentes && tipo !== 'asistente') return false;
  if (meta.solo_docentes && tipo !== 'docente') return false;
  return true;
}

function cloudinaryFolder(tipoFuncionario, rutNormalizado, tipoDocumental) {
  const tipo = tipoFuncionario === 'docente' ? 'docentes' : 'asistentes';
  return `sigex/personal/${tipo}/${rutNormalizado}/${tipoDocumental}`;
}

function cloudinaryFilename(rutNormalizado, tipoDocumental, fechaIso) {
  const f = fechaIso || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${rutNormalizado}_${tipoDocumental}_${f}.pdf`;
}

function calcularEstadoDocumento(fechaVencimiento, diasAlerta = 30) {
  if (!fechaVencimiento) return 'vigente';
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const venc = new Date(String(fechaVencimiento).slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(venc.getTime())) return 'vigente';
  const diff = Math.ceil((venc - hoy) / (1000 * 60 * 60 * 24));
  if (diff < 0) return 'vencido';
  if (diff <= diasAlerta) return 'proximo_vencer';
  return 'vigente';
}

module.exports = {
  PERSONAL_DOC_TIPOS,
  PERSONAL_DOC_TIPOS_OBLIGATORIOS,
  PERSONAL_DOC_TIPOS_ANEXOS,
  PERSONAL_DOC_TIPOS_IMPORTACION,
  isTipoDocumentalValido,
  isTipoObligatorio,
  isTipoAnexo,
  isTipoCargaManual,
  permiteMultiplesActivos,
  tipoDocumentalLabel,
  tiposObligatoriosParaFuncionario,
  tipoPermitidoParaFuncionario,
  cloudinaryFolder,
  cloudinaryFilename,
  calcularEstadoDocumento,
};
