const XLSX = require('xlsx');
const { normalizeRutParts, formatearRut } = require('./rutChileno');

function numeroCelda(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function pickCol(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return row[k];
    }
  }
  return null;
}

/**
 * @param {Buffer} buffer
 * @returns {{ rows: object[], errores: object[], total: number }}
 */
function parseMaestroRemuneracionesExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const rows = [];
  const errores = [];
  const porRut = new Map();

  raw.forEach((row, idx) => {
    const linea = idx + 2;
    const rutRaw = pickCol(row, 'rut', 'RUT', 'Rut');
    const parts = normalizeRutParts(rutRaw);
    if (!parts) {
      errores.push({ linea, rut: String(rutRaw || ''), error: 'RUT inválido' });
      return;
    }

    porRut.set(parts.rut_normalizado, {
      linea,
      rut_normalizado: parts.rut_normalizado,
      rut_display: formatearRut(parts.rut_normalizado),
      nombre: String(pickCol(row, 'nombre', 'NOMBRE') || '').trim(),
      fondo:
        String(pickCol(row, '__EMPTY', 'AFP', 'afp', 'Fondo_AFP') || '').trim() ||
        String(pickCol(row, 'Fondo', 'fondo') || '').trim() ||
        null,
      salud:
        String(pickCol(row, '__EMPTY_1', 'Institucion_Salud', 'institucion_salud') || '').trim() ||
        String(pickCol(row, 'Salud', 'salud') || '').trim() ||
        null,
      tipo_contrato: String(pickCol(row, 'tipocontrato', 'Tipo_de_Contrato', 'tipo_contrato') || '').trim() || null,
      imposiciones: numeroCelda(pickCol(row, 'Imposiciones', 'imposiciones')),
      seg_cesantia_emp: numeroCelda(pickCol(row, 'SEG.CESANTIA EMP.', 'SEG.CESANTIA EMP', 'seg_cesantia_emp')),
      sueldos: numeroCelda(pickCol(row, 'SUELDOS', 'sueldos')),
    });
  });

  rows.push(...porRut.values());

  return { rows, errores, total: raw.length, duplicados_omitidos: raw.length - rows.length - errores.length };
}

module.exports = { parseMaestroRemuneracionesExcel };
