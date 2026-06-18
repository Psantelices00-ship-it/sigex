/** Tipos documentales obligatorios de la carpeta funcionaria (solo PDF). */

const PERSONAL_DOC_TIPOS = [
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
];

const KEYS = new Set(PERSONAL_DOC_TIPOS.map((t) => t.key));

function isTipoDocumentalValido(key) {
  return KEYS.has(String(key || '').trim());
}

function tipoDocumentalLabel(key) {
  return PERSONAL_DOC_TIPOS.find((t) => t.key === key)?.label || key;
}

/** Reglas heurísticas para importación masiva por nombre de archivo. */
const FILENAME_RULES = [
  { tipo: 'curriculum', patterns: [/curriculum/i, /curricul/i, /\bcv\b/i] },
  { tipo: 'certificado_estudios', patterns: [/titulo/i, /t[ií]tulo/i, /estudios/i, /profesional/i] },
  { tipo: 'certificado_antecedentes', patterns: [/antecedentes/i] },
  { tipo: 'certificado_nacimiento', patterns: [/nacimiento/i] },
  { tipo: 'certificado_inhabilidad_menores', patterns: [/inhabilidad/i, /menores/i] },
  { tipo: 'cedula_identidad', patterns: [/cedula/i, /c[eé]dula/i, /identidad/i] },
  { tipo: 'certificado_salud', patterns: [/salud/i, /medico/i, /m[eé]dico/i] },
  { tipo: 'certificado_afp', patterns: [/\bafp\b/i] },
  { tipo: 'certificado_prevision', patterns: [/isapre/i, /fonasa/i, /prevision/i, /previsi[oó]n/i] },
  { tipo: 'certificado_situacion_militar', patterns: [/militar/i, /situacion.?militar/i] },
];

function inferirTipoDocumentalDesdeNombre(filename) {
  const base = String(filename || '').toLowerCase();
  for (const rule of FILENAME_RULES) {
    if (rule.patterns.some((re) => re.test(base))) return rule.tipo;
  }
  return null;
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
  isTipoDocumentalValido,
  tipoDocumentalLabel,
  inferirTipoDocumentalDesdeNombre,
  cloudinaryFolder,
  cloudinaryFilename,
  calcularEstadoDocumento,
};
