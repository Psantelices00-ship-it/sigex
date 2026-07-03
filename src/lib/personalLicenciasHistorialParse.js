const XLSX = require('xlsx');
const { normalizeRutParts, formatearRut } = require('./rutChileno');
const { diasEntreFechas } = require('./personalLicenciasCodigos');

function pickCol(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return row[k];
    }
  }
  return null;
}

function parseDateCell(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  let s = String(v).trim();
  const formula = s.match(/^="(\d{1,2}\/\d{1,2}\/\d{4})"$/);
  if (formula) s = formula[1];
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (typeof v === 'number' && XLSX.SSF) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) {
      const mm = String(d.m).padStart(2, '0');
      const dd = String(d.d).padStart(2, '0');
      return `${d.y}-${mm}-${dd}`;
    }
  }
  return null;
}

function parseIntCell(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function resolverHojaLicencias(wb) {
  const preferida = wb.SheetNames.find((n) => /licencia/i.test(n));
  return wb.Sheets[preferida || wb.SheetNames[0]];
}

/**
 * @param {Buffer} buffer
 * @returns {{ rows: object[], errores: object[], total: number }}
 */
function parseLicenciasHistorialExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = resolverHojaLicencias(wb);
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const rows = [];
  const errores = [];

  raw.forEach((row, idx) => {
    const linea = idx + 2;
    const rutRaw = pickCol(row, 'RUT', 'rut', 'Rut');
    const parts = normalizeRutParts(rutRaw);
    if (!parts) {
      errores.push({ linea, rut: String(rutRaw || ''), error: 'RUT inválido' });
      return;
    }

    const fechaInicio = parseDateCell(pickCol(row, 'FECHA_INICIO', 'fecha_inicio'));
    const fechaTermino = parseDateCell(pickCol(row, 'FECHA_TERMINO', 'fecha_termino', 'FECHA_TERMINO'));
    if (!fechaInicio || !fechaTermino) {
      errores.push({
        linea,
        rut: formatearRut(parts.rut_normalizado),
        error: 'Fechas de inicio o término inválidas',
      });
      return;
    }

    const fechaTramitacion =
      parseDateCell(
        pickCol(
          row,
          'FECHA_TRAMITACION',
          'FECHA_RECEPCION',
          'fecha_tramitacion',
          'fecha_recepcion',
          'FECHA_EMISION'
        )
      ) || null;

    let dias = parseIntCell(pickCol(row, 'DIAS_LICENCIA', 'dias', 'DIAS', 'dias_licencia'));
    if (!dias) dias = diasEntreFechas(fechaInicio, fechaTermino);

    const numeroLicencia = String(
      pickCol(row, 'NUMERO_LICENIA', 'NUMERO_LICENCIA', 'numero_licencia') || ''
    ).trim();

    rows.push({
      linea,
      rut_normalizado: parts.rut_normalizado,
      rut_display: formatearRut(parts.rut_normalizado),
      numero_licencia: numeroLicencia || null,
      fecha_tramitacion: fechaTramitacion,
      fecha_inicio: fechaInicio,
      fecha_termino: fechaTermino,
      dias,
      nombre: String(pickCol(row, 'NOMBRE_FUNCIONARIO', 'nombre') || '').trim() || null,
    });
  });

  return { rows, errores, total: raw.length };
}

module.exports = {
  parseLicenciasHistorialExcel,
  parseDateCell,
};
