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

function cell(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') return row[k];
  }
  // Tolerar encabezados con encoding roto (ej. Ubicaci?n / UbicaciÃ³n)
  const norm = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  const wanted = keys.map(norm);
  for (const [k, v] of Object.entries(row || {})) {
    if (wanted.includes(norm(k)) && v != null && String(v).trim() !== '') return v;
  }
  return '';
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
  const seen = new Set();

  raw.forEach((row, idx) => {
    const linea = idx + 2;
    const rutRaw = cell(row, 'rut', 'RUT', 'Rut');
    const parts = normalizeRutParts(rutRaw);
    if (!parts) {
      errores.push({ linea, rut: String(rutRaw), error: 'RUT inválido' });
      return;
    }
    if (seen.has(parts.rut_normalizado)) {
      // Duplicado en el Excel: se conserva la primera aparición
      return;
    }
    seen.add(parts.rut_normalizado);

    const nombre = String(cell(row, 'nombre', 'NOMBRE', 'Nombre')).trim();
    if (!nombre) {
      errores.push({ linea, rut: formatearRut(parts.rut_normalizado), error: 'Nombre vacío' });
      return;
    }
    const tipoRaw = cell(row, 'TIPO', 'tipo', 'Tipo', 'planta', 'Planta');
    let tipo = normalizeTipoFuncionario(tipoRaw);
    if (!tipo) {
      const cat = String(cell(row, 'Categoria', 'categoria', 'CATEGORIA')).trim().toUpperCase();
      if (cat === 'D') tipo = 'docente';
    }
    if (!tipo) tipo = 'asistente';

    rows.push({
      rut_normalizado: parts.rut_normalizado,
      rut_numero: parts.rut_numero,
      rut_dv: parts.rut_dv,
      nombre_completo: nombre,
      tipo_funcionario: tipo,
      planta: String(cell(row, 'planta', 'Planta')).trim() || null,
      ubicacion: String(cell(row, 'Ubicación', 'Ubicacion', 'ubicacion', 'Ubicaci?n')).trim() || null,
      fecha_ingreso: parseDateCell(cell(row, 'fechaing', 'FECHAING', 'fecha_ingreso')),
      fecha_nacimiento: parseDateCell(cell(row, 'FECHA_NACIMIENTO', 'fecha_nacimiento')),
      profesion: String(cell(row, 'profesion', 'PROFESION', 'Cargo_Especifico')).trim() || null,
      tipo_contrato: String(cell(row, 'Tipo_de_Contrato', 'tipo_contrato')).trim() || null,
      linea,
    });
  });

  return { rows, errores };
}

module.exports = { parseFuncionariosExcel };
