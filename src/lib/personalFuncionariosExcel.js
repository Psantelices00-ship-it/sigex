const XLSX = require('xlsx');
const { normalizeRutParts, formatearRut } = require('./rutChileno');
const { normalizeTipoFuncionario } = require('./personalFuncionarioTipo');

function parseDateCell(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
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

/**
 * @param {Buffer} buffer
 * @returns {{ rows: object[], errores: object[] }}
 */
function parseFuncionariosExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const rows = [];
  const errores = [];

  raw.forEach((row, idx) => {
    const linea = idx + 2;
    const rutRaw = row.rut ?? row.RUT ?? row.Rut ?? '';
    const parts = normalizeRutParts(rutRaw);
    if (!parts) {
      errores.push({ linea, rut: String(rutRaw), error: 'RUT inválido' });
      return;
    }
    const nombre = String(row.nombre ?? row.NOMBRE ?? '').trim();
    if (!nombre) {
      errores.push({ linea, rut: formatearRut(parts.rut_normalizado), error: 'Nombre vacío' });
      return;
    }
    const tipoRaw = row.TIPO ?? row.tipo ?? row.Tipo ?? '';
    const tipo = normalizeTipoFuncionario(tipoRaw) || 'asistente';

    rows.push({
      rut_normalizado: parts.rut_normalizado,
      rut_numero: parts.rut_numero,
      rut_dv: parts.rut_dv,
      nombre_completo: nombre,
      tipo_funcionario: tipo,
      planta: String(row.planta ?? row.Planta ?? '').trim() || null,
      ubicacion: String(row.Ubicación ?? row.Ubicacion ?? row.ubicacion ?? '').trim() || null,
      fecha_ingreso: parseDateCell(row.fechaing ?? row.FECHAING ?? row.fecha_ingreso),
      fecha_nacimiento: parseDateCell(row.FECHA_NACIMIENTO ?? row.fecha_nacimiento),
      profesion: String(row.profesion ?? row.PROFESION ?? '').trim() || null,
      tipo_contrato: String(row.Tipo_de_Contrato ?? row.tipo_contrato ?? '').trim() || null,
      linea,
    });
  });

  return { rows, errores };
}

module.exports = { parseFuncionariosExcel };
