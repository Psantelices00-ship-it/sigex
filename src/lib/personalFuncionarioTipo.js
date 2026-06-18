/** Mapea valores del Excel institucional al tipo interno. */

function normalizeTipoFuncionario(raw) {
  const u = String(raw || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (u.includes('DOCENTE')) return 'docente';
  if (u.includes('ASISTENTE')) return 'asistente';
  return null;
}

function tipoFuncionarioLabel(key) {
  if (key === 'docente') return 'Docente';
  if (key === 'asistente') return 'Asistente de la Educación';
  return key;
}

module.exports = { normalizeTipoFuncionario, tipoFuncionarioLabel };
